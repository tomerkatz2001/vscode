import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { SynthProblem, SynthResult } from '../../../../editor/contrib/rtv/RTVInterfaces.js';
import { IRTVSynth, IRTVSynthService } from '../common/IRTVSynth.js';
import { IRTVLogger } from '../common/IRTVLogger.js';
import { getOSEnvVariable } from './RTVNodeUtils.js';
import * as os from 'os';
import * as fs from 'fs';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { RTVLogger } from './RTVLogger.js';

const SYNTH: string = getOSEnvVariable('SYNTH');
const JAVA = getOSEnvVariable('JAVA');
const HEAP = process.env['HEAP'];

class RTVSynth implements IRTVSynth {
	readonly _serviceBrand: undefined;
	private _resolve?: (value: SynthResult) => void = undefined;
	private _reject?: () => void = undefined;
	private logger: IRTVLogger = new RTVLogger();
	private _problemIdx: number = -1;
	private _synthProcess: ChildProcessWithoutNullStreams;

	constructor() {

		this.logger?.synthProcessStart();

		if (HEAP) {
			this._synthProcess = spawn(JAVA, [`-Xmx${HEAP}`, '-jar', SYNTH]);

		} else {
			this._synthProcess = spawn(JAVA, ['-jar', SYNTH]);
		}

		// shut down the synthesizer with the editor
		process.on('exit', () => this.dispose());
		process.on('beforeExit', async () => this.dispose());
		process.on('uncaughtException', () => this.dispose());
		process.on('SIGINT', () => this.dispose());

		// Log if the synth crashes/exits
		this._synthProcess.on('exit', () => this.logger?.synthProcessEnd());
		this._synthProcess.on('close', () => this.logger?.synthProcessEnd());

		// Log all synthesizer output
		this._synthProcess.stdout.on('data', data => this.logger?.synthStdout(data));
		this._synthProcess.stderr.on('data', data => this.logger?.synthStderr(data));

		// Set up the listeners we use to communicate with the synth
		this._synthProcess.stdout.on('data', (data) => {
			const resultStr = String.fromCharCode.apply(null, data);

			if (this._resolve && this._reject) {
				try {
					// TODO Check result id
					const rs = JSON.parse(resultStr) as SynthResult;
					if (rs.id === this._problemIdx || rs.id === 0) { // TODO remove the rs.id===0 the synthesizer dont update the result id
						// request not discarded
						this._resolve(rs);
						this._resolve = undefined;
						this._reject = undefined;
					} else if (rs.id === -1) {
						console.error(`The synthesizer crashed!`, rs);
					} else {
						console.error(`Request already discarded: ${rs.id}`);
					}
				} catch (e) {
					console.error('Failed to parse synth output: ' + String.fromCharCode.apply(null, data));
				}
			} else {
				console.error('Synth output when not waiting on promise: ');
				console.error(resultStr);
			}
		});

		this._synthProcess
	}

	public synthesize(problem: SynthProblem): Promise<SynthResult | undefined> {
		if (this._reject) {
			this._reject();
			this._resolve = undefined;
			this._reject = undefined;
		}

		// First, create the promise we're returning.
		const rs: Promise<SynthResult> = new Promise((resolve, reject) => {
			this._resolve = resolve;
			this._reject = reject;
		});

		//for debug write the problem in file:
		const values_file: string = os.tmpdir() //+ path.sep + 'tmp_synth_problem.json';
		fs.writeFileSync(values_file, JSON.stringify(problem) + '\n');
		// Then send the problem to the synth
		problem.id = ++this._problemIdx;
		this._synthProcess.stdin.write(JSON.stringify(problem) + '\n');
		console.log(`Started synth process: ${this._problemIdx}`);

		// And we can return!
		return rs;
	}

	public stop(): boolean {
		if (this._reject) {
			this._reject();
			this._reject = undefined;
			this._resolve = undefined;
			return true;
		}
		return false;
	}

	public dispose() {
		this._synthProcess?.kill('SIGKILL');
	}

	public connected(): boolean {
		return this._synthProcess &&
			// this._synthProcess.connected &&
			!this._synthProcess.stdin.destroyed;
	}
}

registerSingleton(IRTVSynthService, RTVSynth, InstantiationType.Eager);
