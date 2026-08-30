import { TaobaoAgentAdapter } from './taobao/adapter.js';
import { isAllowedProductUrl } from './taobao/parser.js';

function usage() {
  console.error(`Usage:
  doctor [--json]
  public-smoke
  probe-session
  search <query> [--brief]
  open-result <query> <index> [--no-screenshot] [--brief]
  open-href <url> [--no-screenshot] [--brief]
  visual-open <url> [--brief]
  visual-resume [--brief]
  visual-close
  download-images <query> <index> [outputDir]

  --brief drops the networkTap array from the printed JSON — the tap is
  diagnostic bulk that routinely pushes search output past agent tool-output
  limits, truncating the candidates that actually matter.
`);
}

function consumeFlag(args: string[], flag: string): { args: string[]; present: boolean } {
  const idx = args.indexOf(flag);
  if (idx === -1) return { args, present: false };
  return { args: [...args.slice(0, idx), ...args.slice(idx + 1)], present: true };
}

function printResult(result: object, brief: boolean) {
  const output = brief ? { ...result, networkTap: undefined } : result;
  console.log(JSON.stringify(output, null, 2));
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
      const { args, present: brief } = consumeFlag(rest, '--brief');
      const query = args.join(' ').trim();
      if (!query) {
        throw new Error('search requires a query');
      }
      const result = await adapter.search(query);
      printResult(result, brief);
      return;
    }

    case 'open-result': {
      const { args: argsAfterBrief, present: brief } = consumeFlag(rest, '--brief');
      const { args, present: noScreenshot } = consumeFlag(argsAfterBrief, '--no-screenshot');
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
      printResult(result, brief);
      return;
    }

    case 'open-href': {
      const { args: argsAfterBrief, present: brief } = consumeFlag(rest, '--brief');
      const { args, present: noScreenshot } = consumeFlag(argsAfterBrief, '--no-screenshot');
      const href = args[0]?.trim();
      if (!href || !isAllowedProductUrl(href)) {
        throw new Error('open-href requires an https product URL on item.taobao.com or detail.tmall.com');
      }
      const result = await adapter.openByHref(href, { screenshot: !noScreenshot });
      printResult(result, brief);
      return;
    }

    case 'visual-open': {
      const { args, present: brief } = consumeFlag(rest, '--brief');
      const href = args[0]?.trim();
      if (!process.env.TAOBAO_CDP_URL) {
        throw new Error('visual-open requires TAOBAO_CDP_URL and a managed attached browser');
      }
      if (!href || !isAllowedProductUrl(href)) {
        throw new Error('visual-open requires an https product URL on item.taobao.com or detail.tmall.com');
      }
      const result = await adapter.stageVisualInspection(href);
      printResult(result, brief);
      return;
    }

    case 'visual-resume': {
      const { args, present: brief } = consumeFlag(rest, '--brief');
      if (args.length > 0) {
        throw new Error('visual-resume accepts only --brief');
      }
      if (!process.env.TAOBAO_CDP_URL) {
        throw new Error('visual-resume requires TAOBAO_CDP_URL and a managed attached browser');
      }
      const result = await adapter.resumeVisualInspection();
      printResult(result, brief);
      return;
    }

    case 'visual-close': {
      if (rest.length > 0) {
        throw new Error('visual-close accepts no arguments');
      }
      if (!process.env.TAOBAO_CDP_URL) {
        throw new Error('visual-close requires TAOBAO_CDP_URL and a managed attached browser');
      }
      console.log(JSON.stringify(await adapter.closeVisualInspection(), null, 2));
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
