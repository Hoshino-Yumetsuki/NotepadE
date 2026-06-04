/**
 * React 19 global-JSX compatibility shim.
 *
 * `@types/react` v19 removed the ambient global `JSX` namespace; the JSX type
 * surface now lives under `React.JSX`. This project annotates component return
 * types as `JSX.Element` in many files, so we re-expose the global namespace as
 * an alias of React's. (The automatic `react-jsx` runtime resolves intrinsic
 * elements via `React.JSX` directly and does not depend on this shim.)
 */
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementType = ReactJSX.ElementType;
    type ElementClass = ReactJSX.ElementClass;
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty;
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
    type IntrinsicAttributes = ReactJSX.IntrinsicAttributes;
    type IntrinsicClassAttributes<T> = ReactJSX.IntrinsicClassAttributes<T>;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
    type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>;
  }
}
