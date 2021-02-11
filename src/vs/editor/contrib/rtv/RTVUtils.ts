/* eslint-disable code-import-patterns */
import * as child_process from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Process, IRTVLogger, ViewMode } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { RTVLogger } from 'vs/editor/contrib/rtv/RTVLogger';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

// Helper functions
export function getOSEnvVariable(v: string): string {
	let result = process.env[v];
	if (result === undefined) {
		throw new Error('OS environment variable ' + v + ' is not defined.');
	}
	return result;
}

const PY3 = getOSEnvVariable('PYTHON3');
const RUNPY = getOSEnvVariable('RUNPY');
const IMGSUM = getOSEnvVariable('IMGSUM');
const SYNTH = getOSEnvVariable('SYNTH');
const SCALA = getOSEnvVariable('SCALA');
const SNIPPY_UTILS = getOSEnvVariable('SNIPPY_UTILS');

abstract class NativeProcess implements Process {
	protected _reject?: () => void;
	constructor(protected process: child_process.ChildProcessWithoutNullStreams) {}

	onStdout(fn: (data: any) => void): void {
		this.process.stdout.on('data', fn);
	}

	onStderr(fn: (data: any) => void): void {
		this.process.stderr.on('data', fn);
	}

	toStdin(msg: string): void {
		this.process.stdin.write(msg);
	}

	kill() {
		this.process.kill();
		if (this._reject) {
			this._reject();
			this._reject = undefined;
		}
	}

	abstract onExit(fn: (exitCode: any, result?: string) => void): void;
	abstract toPromise(): Promise<any>;
}

class RunpyProcess extends NativeProcess {
	constructor(private file: string,
		p: child_process.ChildProcessWithoutNullStreams) {
		super(p)
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.process.on('exit', (exitCode, _) => {
			let result = undefined;

			if (exitCode !== null) {
				result = fs.readFileSync(this.file + '.out').toString();
			}

			fn(exitCode, result);
		});
	}

	toPromise(): Promise<any> {
		return new Promise(
			(resolve, reject) => {
				// We consider failed executions (non-zero exitCode) as resolved.
				this.process.on('exit', (exitCode, _) => {
					let result: string | undefined = undefined;

					if (exitCode !== null) {
						result = fs.readFileSync(this.file + '.out').toString();
					}

					resolve([exitCode, result]);
				});

				// Kill, however, is not resolved!
				this._reject = reject;
			}
		);
	}
}

class SynthProcess extends NativeProcess  {
	constructor(p: child_process.ChildProcessWithoutNullStreams) {
		super(p);
	}

	onExit(fn: (exitCode: any) => void): void {
		this.process.on('close', (exitCode) => fn(exitCode));
	}

	toPromise(): Promise<any> {
		return new Promise((resolve, reject) => {
			this.process.on('close', (exitCode) => resolve(exitCode));
			this._reject = reject;
		});
	}
}

export function runProgram(program: string, values?: any): Process {
	const file: string = os.tmpdir() + path.sep + 'tmp.py';
	fs.writeFileSync(file, program);

	let local_process;

	if (values) {
		const values_file: string = os.tmpdir() + path.sep + 'tmp_values.json';
		fs.writeFileSync(values_file, JSON.stringify(values));
		local_process = child_process.spawn(PY3, [RUNPY, file, values_file]);
	} else {
		local_process = child_process.spawn(PY3, [RUNPY, file]);
	}

	return new RunpyProcess(file, local_process);
}

export function synthesizeSnippet(problem: string): Process {
	const example_fname = os.tmpdir() + path.sep + 'synth_example.json';
	fs.writeFileSync(example_fname, problem);
	let c = child_process.spawn(SCALA, [SYNTH, example_fname]);
	return new SynthProcess(c);
}

export function runImgSummary(program: string, line: number, varname: string): Process {
	const file: string = os.tmpdir() + path.sep + 'tmp.py';
	fs.writeFileSync(file, program);
	const local_process = child_process.spawn(PY3, [IMGSUM, file, line.toString(), varname]);
	return new RunpyProcess(file, local_process);
}

/**
 * Runs the SnipPy helper python code with a request to validate the
 * given user input.
 */
export async function validate(input: string): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		const process = child_process.spawn(SNIPPY_UTILS, ['validate', input]);
		let output: string = '';
		let error: string = '';
		process.stdout.on('data', (data: string) => output += data);
		process.stderr.on('data', (data: string) => error += data);

		process.on('exit', (exitCode: number) => {
			if (exitCode !== 0) {
				reject(error);
			} else {
				resolve(output);
			}
		});
	});
}

export function getLogger(editor: ICodeEditor): IRTVLogger {
	return new RTVLogger(editor);
}

export function isViewModeAllowed(_: ViewMode): boolean {
	return true;
}

export const EOL: string = os.EOL;
