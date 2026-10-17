/** Leading + trailing throttle: the first call runs now, calls inside the window collapse into one at its end. */
export function createThrottle(fn: () => void, ms: number) {
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const call = () => {
    const wait = last + ms - Date.now();
    if (wait <= 0) {
      cancel();
      last = Date.now();
      fn();
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn();
      }, wait);
    }
  };

  return { call, cancel };
}
