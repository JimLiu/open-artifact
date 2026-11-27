import * as React from 'react';

/** A callback that keeps one identity while always calling the latest function given. */
export function useLatestCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result): (...args: Args) => Result {
  let callbackRef = React.useRef(callback);
  React.useLayoutEffect(() => {
    callbackRef.current = callback;
  });
  let [stableCallback] = React.useState(() => (...args: Args): Result => callbackRef.current(...args));
  return stableCallback;
}
