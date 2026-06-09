import { spawn } from 'node:child_process';

const commands = [
  ['backend', ['run', 'dev', '--prefix', 'backend']],
  ['frontend', ['run', 'dev', '--prefix', 'frontend']]
];

const children = commands.map(([name, args]) => {
  const child = spawn('npm', args, {
    stdio: 'inherit',
    shell: true
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${name} termino con codigo ${code}`);
    }
  });

  return child;
});

function shutdown() {
  children.forEach((child) => child.kill('SIGTERM'));
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

