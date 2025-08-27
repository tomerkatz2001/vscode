import { spawn } from 'child_process';
import { getOSEnvVariable } from './RTVNodeUtils.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IRTVValidateService , IRTVValidate} from '../common/IRTVValidate.js';

const PY3 = getOSEnvVariable('PYTHON3');
const SNIPPY_UTILS = getOSEnvVariable('SNIPPY_UTILS');

class RTVValidate implements IRTVValidate {
	_serviceBrand: undefined;
	validate(input: string): Promise<string | undefined> {
		return new Promise((resolve, reject) => {
			const process = spawn(PY3, [SNIPPY_UTILS, 'validate', input]);
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

}

registerSingleton(IRTVValidateService, RTVValidate, InstantiationType.Eager);
