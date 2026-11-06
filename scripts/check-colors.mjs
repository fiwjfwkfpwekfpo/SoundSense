import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const named = 'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ');
const literal = /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi;
const namedLiteral = new RegExp(`(?:["'\x60]\\s*(?:${named.join('|')})\\s*["'\x60]|(?:^|[;{])\\s*[\\w-]+\\s*:\\s*(?:${named.join('|')})(?=[\\s;!}])|(?:fill|stroke|stop-color)\\s*=\\s*["'](?:${named.join('|')})["'])`, 'gim');
export function findColors(text) {
  const matches = [...text.matchAll(literal), ...text.matchAll(namedLiteral)].map(match => ({ value: match[0].trim(), line: text.slice(0, match.index).split('\n').length }));
  // Also inspect complete CSS values, including named colors inside shadows and gradients.
  const blocks = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|style=["']([^"']*)["']/gi)];
  // A TypeScript object is not a CSS declaration block (preset IDs may be
  // ordinary words such as linen). Quoted color literals are checked above.
  if (!blocks.length && !text.includes('<script') && !/\b(?:const|let|export|import|function|interface|type)\b/.test(text)) blocks.push(Object.assign([text, text], { index: 0 }));
  for (const match of text.matchAll(/["'`]([^"'`]*(?:(?:linear|radial|conic)-gradient\(|\d(?:px|rem|em)\b)[^"'`]*)["'`]/gi)) blocks.push(Object.assign([match[0], `value:${match[1]};`], { index: match.index }));
  const namePattern = new RegExp(`\\b(?:${named.join('|')})\\b`, 'gi');
  for (const block of blocks) {
    const css = (block[1] ?? block[2] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const declaration of css.matchAll(/(?:^|[;{])\s*[\w-]+\s*:\s*([^;{}]+)/g)) {
      const value = declaration[1].replace(/var\([^)]*\)/g, '').replace(/url\([^)]*\)/g, '');
      for (const match of value.matchAll(namePattern)) matches.push({ value: match[0], line: text.slice(0, (block.index ?? 0) + (declaration.index ?? 0)).split('\n').length });
    }
  }
  return matches;
}
async function scan(directory) {
  const failures = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) { if (relative(resolve(root, 'src/ui'), path) !== 'appearance/colors') failures.push(...await scan(path)); }
    else if (/\.(?:svelte|css|json|[cm]?[jt]s)$/.test(path)) {
      let contents = await readFile(path, 'utf8');
      if (relative(root, path).startsWith('src/ui/appearance/styles/') && path.endsWith('.json')) {
        const data = JSON.parse(contents); if (data.suggest) delete data.suggest.colors; contents = JSON.stringify(data);
      }
      for (const match of (relative(resolve(root, 'src/ui'), path).startsWith('i18n/') ? [...(await readFile(path, 'utf8')).matchAll(literal)].map(match => ({ value: match[0], line: 1 })) : findColors(contents))) failures.push(`${relative(root, path)}:${match.line} — ${match.value}`);
    }
  }
  return failures;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await scan(resolve(root, 'src/ui'));
  if (failures.length) { console.error(`Hardcoded UI colors are forbidden:\n${failures.join('\n')}`); process.exitCode = 1; }
  else console.log('Colors: all UI colors come from appearance color packs.');
}
