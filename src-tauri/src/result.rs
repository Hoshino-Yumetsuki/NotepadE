//! `NpResult<T>` — the Result envelope every renderer-callable command returns.
//!
//! Mirrors `Result<T>` in src/shared/ipc-contract.ts verbatim:
//!   `{ ok: true, data: T } | { ok: false, error: string }`
//!
//! Rust commands NEVER error at the Tauri layer (the Electron main process never
//! rejected an invoke either) — every failure is folded into the `ok:false`
//! envelope so the renderer-side contract is identical.
//!
//! FROZEN after scaffold (task #1). Workers consume it; signature changes go
//! through team-lead.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Discriminated-union result envelope. `NpResult<()>` serializes the success
/// arm as `{"ok":true,"data":null}` (the TS side types it `Result<void>` and
/// never reads `data`).
#[derive(Debug, Clone, PartialEq)]
pub enum NpResult<T> {
    Ok(T),
    Err(String),
}

impl<T> NpResult<T> {
    /// Fold any displayable error into the envelope.
    pub fn from_result<E: std::fmt::Display>(r: Result<T, E>) -> Self {
        match r {
            Ok(v) => NpResult::Ok(v),
            Err(e) => NpResult::Err(e.to_string()),
        }
    }
}

impl<T, E: std::fmt::Display> From<Result<T, E>> for NpResult<T> {
    fn from(r: Result<T, E>) -> Self {
        NpResult::from_result(r)
    }
}

impl<T: Serialize> Serialize for NpResult<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            NpResult::Ok(data) => {
                let mut s = serializer.serialize_struct("NpResult", 2)?;
                s.serialize_field("ok", &true)?;
                s.serialize_field("data", data)?;
                s.end()
            }
            NpResult::Err(error) => {
                let mut s = serializer.serialize_struct("NpResult", 2)?;
                s.serialize_field("ok", &false)?;
                s.serialize_field("error", error)?;
                s.end()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_serializes_as_envelope() {
        let json = serde_json::to_value(NpResult::Ok(5)).unwrap();
        assert_eq!(json, serde_json::json!({ "ok": true, "data": 5 }));
    }

    #[test]
    fn ok_unit_serializes_data_null() {
        // Result<void> arm: data must be present (null), key order irrelevant.
        let json = serde_json::to_value(NpResult::Ok(())).unwrap();
        assert_eq!(json, serde_json::json!({ "ok": true, "data": null }));
    }

    #[test]
    fn err_serializes_as_envelope() {
        let json = serde_json::to_value(NpResult::<i32>::Err("boom".into())).unwrap();
        assert_eq!(json, serde_json::json!({ "ok": false, "error": "boom" }));
    }

    #[test]
    fn from_result_folds_errors() {
        let r: Result<i32, std::io::Error> = Err(std::io::Error::other("denied"));
        assert_eq!(NpResult::from(r), NpResult::Err("denied".into()));
        let r: Result<i32, std::io::Error> = Ok(7);
        assert_eq!(NpResult::from(r), NpResult::Ok(7));
    }

    #[test]
    fn nested_struct_data() {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Demo {
            file_path: Option<String>,
        }
        let json = serde_json::to_value(NpResult::Ok(Demo { file_path: None })).unwrap();
        assert_eq!(json, serde_json::json!({ "ok": true, "data": { "filePath": null } }));
    }
}
