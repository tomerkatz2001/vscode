import { IRTVNodeUtils, IRTVNodeUtilsService, ParseProcess } from '../common/IRTVNodeUtils.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { ParsedComment } from '../../../../editor/contrib/rtv/comments/RTVComment.js';
import { ReSynthProcess, RunResult, SynthProblem, SynthProcess, SynthResult } from '../../../../editor/contrib/rtv/RTVInterfaces.js';
import { IRTVRunProcess, IRTVRunProcessService } from '../common/IRTVRunProcess.js';
import { IRTVSynth, IRTVSynthService } from '../common/IRTVSynth.js';
import { IRTVReSynth, IRTVReSynthService } from '../common/IRTVReSynth.js';
import { RTVSpecification } from '../../../../editor/contrib/rtv/RTVSpecification.js';
import { IRTVValidate, IRTVValidateService } from '../common/IRTVValidate.js';

const PY3 = getOSEnvVariable('PYTHON3');
const COMMENTS_PARSER = "C:\\Users\\tomerkatz\\Desktop\\LooPy\\vscode\\src\\parse.py";
const SYNTH: string = getOSEnvVariable('SYNTH');

export function getOSEnvVariable(v: string): string {
	let result = process.env[v];
	if (result === undefined) {
		throw new Error('OS environment variable ' + v + ' is not defined.');
	}
	return result;
}


export class RTVNodeUtils implements IRTVNodeUtils {
	constructor(
		@IRTVRunProcessService protected rtvRunProcessService: IRTVRunProcess,
		@IRTVSynthService private readonly rtvSynthService: IRTVSynth,
		@IRTVReSynthService private readonly rtvReSynthService: IRTVReSynth,
		@IRTVValidateService private readonly rtvValidateService: IRTVValidate
	) { }



	readonly _serviceBrand: undefined;
	EOL: string = os.EOL;
	_synth?: SynthProcess;
	_resynth?: ReSynthProcess;

	isLoopy(): Promise<boolean> {
		let configPath = os.tmpdir() + path.sep + "IamRunningLoopy";
		if (fs.existsSync(configPath)) {
			return Promise.resolve(true);
		}
		return Promise.resolve(false);
	}
	getEOL(): Promise<string> {
		return Promise.resolve(os.EOL);
	}
	async parseComment(program: string): Promise<ParsedComment> {
		const file: string = os.tmpdir() + path.sep + 'tmp.py';
		const local_process = spawn(PY3, [COMMENTS_PARSER, program]);
		let parse_process = new LocalParseProcess(file, local_process);
		return await parse_process;
	}

	async runProgram(program: string, cwd?: string | undefined, values?: any): Promise<RunResult> {
		return await this.rtvRunProcessService.runProgram(program, cwd, values);
	}

	synthesizer(): Promise<SynthProcess> {
		// create a new process on init and when the existing child process is killed
		// TODO: maybe there's a better way to handle this...?
		if (!this._synth || !this._synth.connected()) {
			if (SYNTH !== '') {
				this._synth = new LocalSynthProcess(this.rtvSynthService);
			} else {
				this._synth = new EmptySynthProcess();
			}
		}
		return Promise.resolve(this._synth);
	}

	resynthesizer(): Promise<ReSynthProcess> {
		// create a new process on init and when the existing child process is killed
		// TODO: maybe there's a better way to handle this...?
		if (!this._resynth || !this._resynth.connected()) {
			if (SYNTH !== '') {
				this._resynth = new LocalReSynthProcess(this.rtvReSynthService);
			} else {
				console.log("error");
				console.log(1 / 0);
			}
		}
		return Promise.resolve(this._resynth!);
	}

	validate(input: string): Promise<string | undefined> {
		return this.rtvValidateService.validate(input);
	}
}


class LocalParseProcess implements ParseProcess {
	protected _reject?: () => void;
	protected _promise: Promise<ParsedComment> = new Promise(() => { });

	public stdout: string = '';
	public stderr: string = '';

	constructor(
		protected _file: string,
		protected _process: ChildProcessWithoutNullStreams) {
		this._promise = new Promise((resolve, reject) => {
			this._reject = reject;
			setTimeout(() => reject("timeout"), 5000);
			this._process.stdout.on('data', (data) => this.stdout += data);
			this._process.stderr.on('data', (data) => {
				console.log("Parsing Comment got error:\n" + data.toString());
				this.stderr += data;
			});
			this._process.on('exit', (exitCode) => {
				try {
					let parsed = JSON.parse(this.stdout);
					resolve(new ParsedComment(parsed["varnames"], parsed["envs"], [], parsed["out"]));
				}
				catch (e) {
					console.log(this.stdout)
					console.error("error while parsing the comments");
				}
			});
		});
	}
	async then<TResult1 = ParsedComment, TResult2 = never>(
		onfulfilled?: ((value: ParsedComment) => TResult1 | PromiseLike<TResult1>) | undefined | null,
		onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
		return this._promise.then(onfulfilled, onrejected);
	}

	async catch<TResult = never>(
		onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<any | TResult> {
		return this._promise.catch(onrejected);
	}

	kill(): boolean {
		this._process.kill();
		if (this._reject) {
			this._reject();
			this._reject = undefined;
		}
		return true;
	}
}


class EmptySynthProcess implements SynthProcess {
	synthesize(_problem: SynthProblem): Promise<SynthResult | undefined> {
		return Promise.resolve(undefined);
	}

	stop(): boolean {
		return true;
	}

	connected(): boolean {
		return true;
	}
}


class LocalSynthProcess implements SynthProcess {

	constructor(@IRTVSynthService protected rtvSynthService: IRTVSynth) {
	}

	public synthesize(problem: SynthProblem): Promise<SynthResult | undefined> {
		return this.rtvSynthService.synthesize(problem);
	}


	public stop(): boolean {
		return this.rtvSynthService.stop();
	}


	public connected(): boolean {
		return this.rtvSynthService.connected();
	}
}

class LocalReSynthProcess implements ReSynthProcess {
	constructor(@IRTVReSynthService protected rtvSynthService: IRTVReSynth) {
	}
	reSynthesize(problem: RTVSpecification): Promise<SynthResult | undefined> {
		return this.rtvSynthService.reSynthesize(problem);
	}
	stop(): boolean {
		return this.rtvSynthService.stop();
	}
	connected(): boolean {
		return this.rtvSynthService.connected();
	}

}

registerSingleton(IRTVNodeUtilsService, RTVNodeUtils, InstantiationType.Eager);
