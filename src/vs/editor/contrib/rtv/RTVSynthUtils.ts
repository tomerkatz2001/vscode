import * as child_process from 'child_process';
import * as utils from 'vs/editor/contrib/rtv/RTVUtils';

const SNIPPY_UTILS = utils.getOSEnvVariable('SNIPPY_UTILS');

export async function validate(input: string): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		const process = child_process.spawn(SNIPPY_UTILS, ['validate', input]);
		let output: string = '';
		let error: string = '';
		process.stdout.on('data', (data: string) => output += data);
		process.stderr.on('data', (data: string) => error += data);

		process.on('exit', (exitCode: number) => {
			if (exitCode !== 0) {
				console.error('Failed to run SNIPPY_UTILS: ' + error);
				reject(error);
			} else {
				console.log('resolving validate with output: ' + output);
				resolve(output);
			}
		});
	});
}
