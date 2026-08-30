import { XianyuAgentAdapter } from './adapter.js';
import { isAllowedXianyuItemUrl } from './parser.js';

function usage() {
  console.error(`Usage:
  search <query> [--brief]
  open-href <url> [--no-screenshot] [--brief]
  e2e-live is provided by the wrapper, not this CLI

This CLI is intentionally gated. Invoke it through:
  scripts/ultrasource.sh Ultrasource <action> [args...]
`);
}

function consumeFlag(args: string[], flag: string): { args: string[]; present: boolean } {
  const index = args.indexOf(flag);
  if (index === -1) return { args, present: false };
  return { args: [...args.slice(0, index), ...args.slice(index + 1)], present: true };
}

function printResult(result: object, brief: boolean) {
  if (!brief) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const compact = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  if (Array.isArray(compact.candidates)) {
    compact.candidates = compact.candidates.slice(0, 20);
  }
  if (Array.isArray(compact.imageUrls)) {
    compact.imageUrls = compact.imageUrls.slice(0, 12);
  }
  console.log(JSON.stringify(compact, null, 2));
}

async function main() {
  if (process.env.ULTRASOURCE_TRIGGER !== 'Ultrasource') {
    throw new Error('ULTRASOURCE_TRIGGER_REQUIRED: use the exact case-sensitive standalone token Ultrasource');
  }

  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  const adapter = new XianyuAgentAdapter();
  if (command === 'search') {
    const { args, present: brief } = consumeFlag(rest, '--brief');
    const query = args.join(' ').trim();
    if (!query) throw new Error('Ultrasource search requires a query');
    printResult(await adapter.search(query), brief);
    return;
  }
  if (command === 'open-href') {
    const { args: afterBrief, present: brief } = consumeFlag(rest, '--brief');
    const { args, present: noScreenshot } = consumeFlag(afterBrief, '--no-screenshot');
    const href = args[0]?.trim();
    if (!href || !isAllowedXianyuItemUrl(href)) {
      throw new Error('Ultrasource open-href requires an HTTPS www.goofish.com/item URL with a numeric id');
    }
    printResult(await adapter.openByHref(href, { screenshot: !noScreenshot }), brief);
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
