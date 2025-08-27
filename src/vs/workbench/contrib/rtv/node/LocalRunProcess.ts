import { ChildProcessWithoutNullStreams } from 'child_process';
import { RunResult } from '../../../../editor/contrib/rtv/RTVInterfaces.js';
import * as fs from 'fs';
import { IRTVRunProcess } from '../common/IRTVRunProcess.js';

export class LocalRunProcess implements IRTVRunProcess {
	readonly _serviceBrand: undefined;

	protected _reject?: () => void;
	protected _promise: Promise<RunResult> = new Promise(() => { });

	public stdout: string = '';
	public stderr: string = '';

	constructor(
		protected _file: string,
		protected _process: ChildProcessWithoutNullStreams,
	) {
		this._promise = new Promise((resolve, reject) => {
			this._reject = reject;

			this._process.stdout.on('data', (data) => this.stdout += data);
			this._process.stderr.on('data', (data) => {
				console.log(data.toString());
				this.stderr += data;
			});
			this._process.on('exit', (exitCode) => {
				let result = undefined;
				let testResults = undefined;
				let conflictResults = undefined;
				if (exitCode !== null) {
					result = fs.readFileSync(this._file + '.out').toString();
				}
				testResults = fs.readFileSync(this._file + '.test').toString();
				conflictResults = fs.readFileSync(this._file + ".conflicts").toString();

				resolve(new RunResult(this.stdout, this.stderr, exitCode, result, testResults, conflictResults));
			});
		});
	}
	runProgram(program: string, cwd?: string | undefined, values?: any): Promise<RunResult> {
		throw new Error('Method not implemented.');
	}

	kill(): boolean {
		this._process.kill();
		if (this._reject) {
			this._reject();
			this._reject = undefined;
		}
		return true;
	}

	async then<TResult1 = RunResult, TResult2 = never>(
		onfulfilled?: ((value: RunResult) => TResult1 | PromiseLike<TResult1>) | undefined | null,
		onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
		return this._promise.then(onfulfilled, onrejected);
	}

	async catch<TResult = never>(
		onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<any | TResult> {
		return this._promise.catch(onrejected);
	}
}
