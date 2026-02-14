const useColor = !process.env.NO_COLOR && process.stdout.isTTY;

function wrap(code: string, reset: string) {
  return (text: string) => useColor ? `${code}${text}${reset}` : text;
}

export const bold = wrap('\x1b[1m', '\x1b[22m');
export const dim = wrap('\x1b[2m', '\x1b[22m');
export const red = wrap('\x1b[31m', '\x1b[39m');
export const green = wrap('\x1b[32m', '\x1b[39m');
export const yellow = wrap('\x1b[33m', '\x1b[39m');
export const cyan = wrap('\x1b[36m', '\x1b[39m');
