import { RunResult } from '../../../../editor/contrib/rtv/RTVInterfaces.js';
import * as os from 'os';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { getOSEnvVariable } from './RTVNodeUtils.js';
import { LocalRunProcess } from './LocalRunProcess.js';
import { IRTVRunProcess, IRTVRunProcessService } from '../common/IRTVRunProcess.js';
import path from 'path';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';

const PY3 = getOSEnvVariable('PYTHON3');
const RUNPY = getOSEnvVariable('RUNPY');


class RTVRunProcess implements IRTVRunProcess {
	readonly _serviceBrand: undefined;

	private _process: LocalRunProcess | undefined = undefined;

	then<TResult1 = RunResult, TResult2 = never>(onfulfilled?: ((value: RunResult) => TResult1 | PromiseLike<TResult1>) | null | undefined, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined): PromiseLike<TResult1 | TResult2> {
		throw new Error('Method not implemented.');
	}
	kill(): boolean {
		return this._process?.kill() ?? true;
	}


	async runProgram(program: string, cwd?: string, values?: any): Promise<RunResult> {
		const file: string = os.tmpdir() + path.sep + 'tmp.py';
		fs.writeFileSync(file, program);

		let local_process;

		let options = undefined
		if (cwd) {
			options = { cwd: cwd };
		}
		if (values) {
			const values_file: string = os.tmpdir(); + //path.sep + 'tmp_values.json';
				fs.writeFileSync(values_file, JSON.stringify(values));
			local_process = spawn(PY3, [RUNPY, file, values_file], options);
		} else {
			local_process = spawn(PY3, [RUNPY, file], options);
		}

		this._process = new LocalRunProcess(file, local_process);
		return await this._process;
	}
}

registerSingleton(IRTVRunProcessService, RTVRunProcess, InstantiationType.Eager);
