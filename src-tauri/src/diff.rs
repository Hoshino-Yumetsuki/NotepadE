use serde::Serialize;
use similar::{ChangeTag, TextDiff};

use crate::result::NpResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffPiece {
    pub text: String,
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRow {
    pub kind: &'static str,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pieces: Option<Vec<DiffPiece>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffModel {
    pub left: Vec<DiffRow>,
    pub right: Vec<DiffRow>,
}

fn imaginary_row() -> DiffRow {
    DiffRow {
        kind: "imaginary",
        text: String::new(),
        pieces: None,
    }
}

fn char_pieces(old_line: &str, new_line: &str) -> (Vec<DiffPiece>, Vec<DiffPiece>) {
    let diff = TextDiff::from_chars(old_line, new_line);
    let mut left = Vec::new();
    let mut right = Vec::new();
    for change in diff.iter_all_changes() {
        let text = change.value().to_string();
        match change.tag() {
            ChangeTag::Equal => {
                left.push(DiffPiece {
                    text: text.clone(),
                    kind: "unchanged",
                });
                right.push(DiffPiece {
                    text,
                    kind: "unchanged",
                });
            }
            ChangeTag::Delete => {
                left.push(DiffPiece {
                    text,
                    kind: "deleted",
                });
            }
            ChangeTag::Insert => {
                right.push(DiffPiece {
                    text,
                    kind: "inserted",
                });
            }
        }
    }
    (left, right)
}

fn emit_replace_block(
    removed: &[&str],
    added: &[&str],
    left: &mut Vec<DiffRow>,
    right: &mut Vec<DiffRow>,
) {
    let paired = removed.len().min(added.len());
    for i in 0..paired {
        let (lp, rp) = char_pieces(removed[i], added[i]);
        left.push(DiffRow {
            kind: "modified",
            text: removed[i].to_string(),
            pieces: Some(lp),
        });
        right.push(DiffRow {
            kind: "modified",
            text: added[i].to_string(),
            pieces: Some(rp),
        });
    }
    for i in paired..removed.len() {
        left.push(DiffRow {
            kind: "deleted",
            text: removed[i].to_string(),
            pieces: None,
        });
        right.push(imaginary_row());
    }
    for i in paired..added.len() {
        left.push(imaginary_row());
        right.push(DiffRow {
            kind: "inserted",
            text: added[i].to_string(),
            pieces: None,
        });
    }
}

fn build_diff_model(original: &str, modified: &str) -> DiffModel {
    let diff = TextDiff::from_lines(original, modified);
    let mut left = Vec::new();
    let mut right = Vec::new();

    let changes: Vec<_> = diff.iter_all_changes().collect();
    let mut i = 0;
    while i < changes.len() {
        let change = &changes[i];
        match change.tag() {
            ChangeTag::Equal => {
                let text = change.value().trim_end_matches('\n').to_string();
                left.push(DiffRow {
                    kind: "unchanged",
                    text: text.clone(),
                    pieces: None,
                });
                right.push(DiffRow {
                    kind: "unchanged",
                    text,
                    pieces: None,
                });
                i += 1;
            }
            ChangeTag::Delete => {
                // Collect consecutive deletions
                let mut removed = Vec::new();
                while i < changes.len() && changes[i].tag() == ChangeTag::Delete {
                    removed.push(changes[i].value().trim_end_matches('\n'));
                    i += 1;
                }
                // Check if followed by insertions (replace block)
                let mut added = Vec::new();
                while i < changes.len() && changes[i].tag() == ChangeTag::Insert {
                    added.push(changes[i].value().trim_end_matches('\n'));
                    i += 1;
                }
                if added.is_empty() {
                    for line in &removed {
                        left.push(DiffRow {
                            kind: "deleted",
                            text: line.to_string(),
                            pieces: None,
                        });
                        right.push(imaginary_row());
                    }
                } else {
                    emit_replace_block(&removed, &added, &mut left, &mut right);
                }
            }
            ChangeTag::Insert => {
                let text = change.value().trim_end_matches('\n').to_string();
                left.push(imaginary_row());
                right.push(DiffRow {
                    kind: "inserted",
                    text,
                    pieces: None,
                });
                i += 1;
            }
        }
    }

    DiffModel { left, right }
}

#[tauri::command]
pub async fn compute_diff(original: String, modified: String) -> NpResult<DiffModel> {
    NpResult::Ok(build_diff_model(&original, &modified))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_texts_produce_unchanged_rows() {
        let model = build_diff_model("a\nb\n", "a\nb\n");
        assert_eq!(model.left.len(), model.right.len());
        assert!(model.left.iter().all(|r| r.kind == "unchanged"));
    }

    #[test]
    fn pure_insertion() {
        let model = build_diff_model("a\n", "a\nb\n");
        assert_eq!(model.left.len(), model.right.len());
        assert!(model.left.iter().any(|r| r.kind == "imaginary"));
        assert!(model.right.iter().any(|r| r.kind == "inserted"));
    }

    #[test]
    fn pure_deletion() {
        let model = build_diff_model("a\nb\n", "a\n");
        assert_eq!(model.left.len(), model.right.len());
        assert!(model.left.iter().any(|r| r.kind == "deleted"));
        assert!(model.right.iter().any(|r| r.kind == "imaginary"));
    }

    #[test]
    fn modified_line_has_char_pieces() {
        let model = build_diff_model("hello\n", "hallo\n");
        assert_eq!(model.left.len(), 1);
        assert_eq!(model.left[0].kind, "modified");
        assert!(model.left[0].pieces.is_some());
        assert!(model.right[0].pieces.is_some());
    }

    #[test]
    fn columns_always_same_length() {
        let model = build_diff_model("a\nb\nc\n", "x\ny\n");
        assert_eq!(model.left.len(), model.right.len());
    }
}
