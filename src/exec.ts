import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

export interface ExecOptions {
	readonly cwd: string;
	readonly env?: Record<string, string | undefined>;
	/** Kept quiet unless it fails; the tail is printed then. */
	readonly quiet?: boolean;
	readonly timeoutMs?: number;
	/** Also written here as it comes, so a long step can be followed. */
	readonly logFile?: string;
}

export interface ExecResult {
	readonly code: number;
	readonly output: string;
	readonly ms: number;
}

export class ExecError extends Error {
	readonly result: ExecResult;
	constructor(command: string, result: ExecResult) {
		super(`${command} exited ${result.code} after ${Math.round(result.ms / 1000)} s\n${result.output.slice(-4000)}`);
		this.result = result;
	}
}

/** Runs one command (no shell), streaming its output unless quiet; throws ExecError on a non-zero exit. */
export async function exec(command: string, args: readonly string[], options: ExecOptions): Promise<ExecResult> {
	const result = await execAllowFail(command, args, options);
	if (result.code !== 0) throw new ExecError(`${command} ${args.join(' ')}`, result);
	return result;
}

export function execAllowFail(command: string, args: readonly string[], options: ExecOptions): Promise<ExecResult> {
	const started = performance.now();
	return new Promise((done, fail) => {
		const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		const log = options.logFile ? createWriteStream(options.logFile, { flags: 'a' }) : undefined;
		const take = (chunk: Buffer) => {
			const text = chunk.toString();
			log?.write(text);
			output += text;
			if (output.length > 2_000_000) output = output.slice(-1_000_000);
			if (!options.quiet) process.stdout.write(text);
		};
		child.stdout.on('data', take);
		child.stderr.on('data', take);
		const timer = options.timeoutMs ? setTimeout(() => child.kill('SIGTERM'), options.timeoutMs) : undefined;
		child.on('error', fail);
		child.on('close', (code, signal) => {
			if (timer) clearTimeout(timer);
			log?.end();
			done({ code: code ?? (signal ? 128 : 1), output, ms: performance.now() - started });
		});
	});
}

/** A child that keeps running (a site server); stop() ends it and its output is kept for a failure report. */
export function background(command: string, args: readonly string[], options: ExecOptions): { stop(): Promise<void>; output(): string; exited: Promise<number> } {
	const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
	let output = '';
	const take = (chunk: Buffer) => {
		output += chunk.toString();
		if (output.length > 400_000) output = output.slice(-200_000);
	};
	child.stdout.on('data', take);
	child.stderr.on('data', take);
	const exited = new Promise<number>((done) => child.on('close', (code) => done(code ?? 1)));
	return {
		output: () => output,
		exited,
		async stop() {
			if (child.exitCode !== null || child.pid === undefined) return;
			try {
				process.kill(-child.pid, 'SIGTERM');
			} catch {}
			const killed = await Promise.race([exited.then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), 5_000))]);
			if (!killed) {
				try {
					process.kill(-child.pid, 'SIGKILL');
				} catch {}
			}
		},
	};
}
