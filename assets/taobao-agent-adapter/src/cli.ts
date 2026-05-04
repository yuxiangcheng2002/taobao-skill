import { TaobaoAgentAdapter } from './taobao/adapter.js';

function usage() {
  console.error(`Usage:
  doctor [--json]
  public-smoke
  probe-session
  search <query>
  open-result <query> <index> [--no-screenshot]
  open-href <url> [--no-screenshot]
  download-images <query> <index> [outputDir]
`);
}

function consumeFlag(args: string[], flag: string): { args: string[]; present: boolean } {
  const idx = args.indexOf(flag);
  if (idx === -1) return { args, present: false };
  return { args: [...args.slice(0, idx), ...args.slice(idx + 1)], present: true };
}

async function main() {
  const adapter = new TaobaoAgentAdapter();
  const [command, ...rest] = process.argv.slice(2);

  if (!command) {
    usage();
    process.exit(1);
  }

  switch (command) {
    case 'doctor': {
      const result = adapter.doctor();
      if (rest.includes('--json')) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.table(result);
      }
      return;
    }

    case 'public-smoke': {
      const result = await adapter.runPublicSmoke();
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'probe-session': {
      const result = await adapter.probeSession();
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'search': {
      const query = rest.join(' ').trim();
      if (!query) {
        throw new Error('search requires a query');
      }
      const result = await adapter.search(query);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'open-result': {
      const { args, present: noScreenshot } = consumeFlag(rest, '--no-screenshot');
      if (args.length < 2) {
        throw new Error('open-result requires: <query> <index>');
      }
      const indexText = args[args.length - 1] ?? '';
      const query = args.slice(0, -1).join(' ').trim();
      const index = Number.parseInt(indexText, 10);
      if (!query || Number.isNaN(index) || index < 1) {
        throw new Error('open-result requires a non-empty query and a 1-based index');
      }
      const result = await adapter.openResult(query, index, { screenshot: !noScreenshot });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'open-href': {
      const { args, present: noScreenshot } = consumeFlag(rest, '--no-screenshot');
      const href = args[0]?.trim();
      if (!href || !/^https?:\/\//.test(href)) {
        throw new Error('open-href requires an http(s) url');
      }
      const result = await adapter.openByHref(href, { screenshot: !noScreenshot });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case 'download-images': {
      if (rest.length < 2) {
        throw new Error('download-images requires: <query> <index> [outputDir]');
      }

      const last = rest[rest.length - 1] ?? '';
      const maybeIndex = Number.parseInt(last, 10);
      const hasOutputDir = Number.isNaN(maybeIndex);
      const actualIndexText = hasOutputDir ? rest[rest.length - 2] ?? '' : last;
      const outputDir = hasOutputDir ? rest[rest.length - 1] : undefined;
      const query = rest.slice(0, hasOutputDir ? -2 : -1).join(' ').trim();
      const index = Number.parseInt(actualIndexText, 10);

      if (!query || Number.isNaN(index) || index < 1) {
        throw new Error('download-images requires a non-empty query and a 1-based index');
      }

      const result = await adapter.downloadImages(query, index, outputDir);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    default:
      usage();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
