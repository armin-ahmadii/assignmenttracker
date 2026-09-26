// Build the production app, serve it locally, and open a Cloudflare quick tunnel
// so a phone can load it over HTTPS. Prints the address and a QR code to scan.
//
//   npm run share          (Ctrl+C to stop)
//
// Uses `cloudflared` from your PATH if installed, otherwise fetches it with npx.
import { spawn, spawnSync } from 'node:child_process';
import { build, preview } from 'vite';
import { renderUnicodeCompact } from 'uqr';

const PORT = 4173;
const origin = `http://127.0.0.1:${PORT}`;

console.log('Building the app…');
await build({ logLevel: 'warn' });
const server = await preview({ logLevel: 'warn', preview: { host: '127.0.0.1', port: PORT, strictPort: true } });
console.log(`Serving ${origin}\nOpening a Cloudflare tunnel…`);

const installed = spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).status === 0;
const tunnelArgs = ['tunnel', '--no-autoupdate', '--url', origin];
const [command, args] = installed
  ? ['cloudflared', tunnelArgs]
  : ['npx', ['--yes', 'cloudflared@0.7.3', ...tunnelArgs]];
const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });

let url = null;
let log = '';
const watch = (chunk) => {
  const text = chunk.toString();
  log = (log + text).slice(-4000);
  const match = !url && text.match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/);
  if (!match) return;
  url = match[0];
  console.log(`\nOpen this on your phone:\n\n  ${url}\n`);
  console.log(renderUnicodeCompact(url, { border: 1 }));
  console.log(
    [
      '',
      'It can take a few seconds before the address answers.',
      'Each run gets a new address, and the phone keeps data per address:',
      'turn on sync (Settings → Sync), or connect with your key, to carry work between runs.',
      'Keep this window open. Ctrl+C stops sharing.',
    ].join('\n'),
  );
};
child.stdout.on('data', watch);
child.stderr.on('data', watch);

const stop = (code = 0) => {
  child.kill();
  server.httpServer.close();
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
child.on('exit', (code) => {
  if (!url) {
    console.error('\ncloudflared stopped before the tunnel was ready. Its last output:\n');
    console.error(log.trim() || '(nothing)');
  }
  stop(code ?? 1);
});
