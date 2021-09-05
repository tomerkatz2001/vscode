import { TableElement, isHtmlEscape } from 'vs/editor/contrib/rtv/RTVUtils';


export class RTVSynthModel {
	private _allEnvs: any[] = [];
	private _prevEnvs?: Map<number, any>;
	private _boxEnvs: {[k: string]: [v: any]}[] = [];
	private _boxVars: Set<string> = new Set<string>();
	private _lineNumber: number;
	private _rowsValid: boolean[] = [];
	private _includedTimes: Set<number> = new Set();
	private _outputVars: string[];
	private _rows?: TableElement[][];
	onBoxContentChanged?: (data: {[k: string]: any}, init?: boolean) => void;

	constructor(
		outputVars: string[],
		lineno: number,
		boxVars: Set<string>
	) {
		this._outputVars = outputVars;
		this._lineNumber = lineno;
		this._boxVars = boxVars;
	}

	get boxEnvs(): {[k: string]: [v: any]}[] {
		return this._boxEnvs;
	}

	get includedTimes(): Set<number> {
		return this._includedTimes;
	}

	get prevEnvs(): Map<number, any> {
		return this._prevEnvs!;
	}

	get varnames(): string[] {
		return this._outputVars!;
	}

	bindBoxContentChanged(callback: (data: {[k: string]: any}, init?: boolean) => void) {
		this.onBoxContentChanged = callback;
	}

	_commit(init: boolean = false) {
		this.onBoxContentChanged!(
			{
				'rows': this._rows!,
				'includedTimes': this._includedTimes!,
				'boxEnvs': this._boxEnvs!
			}, init);
	}

	public updateBoxContent(newEnvs: {[k: string] : [v: {[k1: string]: any}]}, init: boolean = false) {
		this.updateBoxEnvs(newEnvs);
		this.updateRowsValid();
		this._commit(init);
	}


	/**
	 * Updates `allEnvs` and `prevEnvs`
	 * @param runResults
	 * @param includedTimes
	 */
	public updateAllEnvs(runResults: any, includedTimes?: Set<number>): void {
		if (includedTimes) {
			this._includedTimes = includedTimes;
		}

		this._allEnvs = [];
		for (let line in (runResults[2] as { [k: string]: any[]; })) {
			this._allEnvs = this._allEnvs.concat(runResults[2][line]);
		}

		this._prevEnvs = new Map<number, any>();

		for (const startEnv of this._allEnvs) {
			const start = startEnv['time'];
			let minDelta = 1024 * 1024;
			let minEnv = undefined;

			for (const env of this._allEnvs) {
				const time = env['time'];
				if (time) {
					const delta = start - time;
					if (delta > 0 && delta < minDelta) {
						minDelta = delta;
						minEnv = env;

						if (delta === 1) {
							break;
						}
					}
				}
			}

			if (minEnv) {
				this._prevEnvs.set(start, minEnv);
			}
		}
	}

	/**
	 * Updates `boxEnvs' and builds `rows`
	 * @param newEnvs
	 */
	public updateBoxEnvs(newEnvs: {[k: string] : [v: {[k1: string]: any}]}) {

		let outVarNames: string[];
		if (!this._outputVars) {
			outVarNames = [];
		} else {
			outVarNames = this._outputVars!;
		}

		this._boxEnvs = this.computeEnvs(newEnvs);
		let envs = this._boxEnvs;
		let vars = this._boxVars;

		if (this._prevEnvs) {
			const oldVars = vars;
			vars = new Set();
			for (const v of oldVars) {
				// remove any variables newly defined by the synthsizer
				let rs = true;
				if (outVarNames.includes(v)) {
					for (const env of envs) {
						// (Lisa) Typescript's automatic fix...
						const time = env['time'] as unknown as number;
						const prev = this._prevEnvs.get(time);
						if (prev) {
							rs = v in prev;
						}
					}
				}

				if (rs) {
					vars.add(v);
				}
			}
		}

		// Generate header
		let rows: TableElement[][] = [];
		let header: TableElement[] = [];
		vars.forEach((v: string) => {
			let name = '**' + v + '**';
			if (outVarNames.includes(v)) {
				name = '```html\n<strong>' + v + '</strong><sub>in</sub>```'
			} else {
				name = '**' + v + '**'
			}
			header.push(new TableElement(name, 'header', 'header', 0, ''));
		});
		outVarNames.forEach((ov: string, i: number) => {
			header.push(new TableElement('```html\n<strong>' + ov + '</strong><sub>out</sub>```', 'header', 'header', 0, '', undefined, i === 0));
		});

		rows.push(header);

		// Generate all rows
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			let loopID = env['$'] as unknown as string;
			let iter = env['#'] as unknown as string;
			let row: TableElement[] = [];
			vars.forEach((v: string) => {
				let varName = v;
				let varEnv = env;

				if (outVarNames.includes(v)) {
					varName += '_in';
					if (this._prevEnvs && this._prevEnvs.has(env['time'] as unknown as number)) {
						varEnv = this._prevEnvs.get(env['time'] as unknown as number);
					}
				}

				let s = varEnv[v] ? varEnv[v] as unknown as string : '';
				let v_str: string = (!s || isHtmlEscape(s)) ? s : '```python\n' + s + '\n```';

				row.push(new TableElement(v_str, loopID, iter, this._lineNumber!, varName, varEnv));
			});
			outVarNames.forEach((v: string, i: number) => {
				let s = env[v] ? env[v] as unknown as string : '';
				let v_str: string = (!s || isHtmlEscape(s)) ? s : '```python\n' + s + '\n```';
				row.push(new TableElement(v_str, loopID, iter, this._lineNumber!, v, env, i === 0));
			});
			rows.push(row);
		}

		this._rows = rows;

	}

	/**
	 * updates `rowsValid` to compute cells that are editable
	 */
	public updateRowsValid() {
		const boxEnvs = this._boxEnvs;
		if (boxEnvs.some(env => Object.keys(env).length <= 2)) {
			// We have empty rows, so we must be inside a conditional :(
			// Any non-empty row is valid here, since this counts as small-step.
			this._rowsValid = boxEnvs.map((env, _) => Object.keys(env).length > 2);
		} else {
			this._rowsValid = boxEnvs.map((env, i) => {
				let time: number;
				let rs = false;
				if (env) {
					time = env['time'] as unknown as number;
					const iter: string | undefined = env['#'] as unknown as string;
					rs = !iter ||
						iter === '0' ||
						(i > 0 && this._includedTimes.has(boxEnvs[i - 1]['time'] as unknown as number));
				}

				// This row is no longer valid. Remove it from the included time!
				if (!rs && this._includedTimes.has(time!)) {
					this._includedTimes.delete(time!);
				}

				return rs;
			});
		}

		if (this._rowsValid!.length === 0) {
			console.error('No rows found.');
			this._rowsValid = [true];
		} else if (!this._rowsValid!.includes(true)) {
			console.error('All rows invalid!');
			this._rowsValid[0] = true;
		}

		const outputVars: Set<string> = new Set(this._outputVars!);
		const rows = this._rows!;
		// indices start from 1 to skip the header
		for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
			const row = rows[rowIdx];
			for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
				const cellVar = row[_colIdx].vname!;
				if (outputVars.has(cellVar)) {
					if (this._rowsValid[rowIdx - 1]) {
						row[_colIdx].editable = true;
					}
				}
			}
		}
	}

	/**
	 *
	 * @returns values for a synth requests
	 */
	public getValues() : {[k: string] : {[k1: string] : [v1: Object]}} {
		let values: {[k: string] : {[k1: string] : [v1: Object]}} = {};
		for (let env of this._boxEnvs!) {
			if (this._includedTimes.has(env['time'] as unknown as number)) {
				values[`(${env['lineno']},${env['time']})`] = env;
			}
		}
		return values;
	}


	/**
	 * Helpfer function that computes `boxEnvs`
	 * @param allEnvs
	 * @returns
	 */
	public computeEnvs(allEnvs: {[k: string] : [v: {[k1: string]: any}]}) : {[k: string]: [v: any]}[]{
		// Get all envs at this line number
		let envs;
		envs = allEnvs[this._lineNumber!-1];
		envs = this.addMissingLines(envs);
		return envs;
	}


	// helper function copied from `RTVDisplay.ts`
	private addMissingLines(envs: {[k: string]: [v: any]}[]): {[k: string]: [v: any]}[] {
		let last = function <T>(a: T[]): T { return a[a.length - 1]; };
		let active_loop_iters: number[] = [];
		let active_loop_ids: string[] = [];
		let envs2: any[] = [];
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			if (env.begin_loop !== undefined) {
				if (active_loop_iters.length > 0) {
					let loop_iters: string[] = (env.begin_loop as unknown as string).split(',');
					this.bringToLoopCount(envs2, active_loop_iters, last(active_loop_ids), +loop_iters[loop_iters.length - 2]);
				}
				active_loop_ids.push(env['$'] as unknown as string);
				active_loop_iters.push(0);
			} else if (env.end_loop !== undefined) {
				let loop_iters: string[] = (env.end_loop as unknown as string).split(',');
				this.bringToLoopCount(envs2, active_loop_iters, last(active_loop_ids), +last(loop_iters));
				active_loop_ids.pop();
				active_loop_iters.pop();
				active_loop_iters[active_loop_iters.length - 1]++;
			} else {
				let loop_iters: string[] = (env['#'] as unknown as string).split(',');
				this.bringToLoopCount(envs2, active_loop_iters, last(active_loop_ids), +last(loop_iters));
				envs2.push(env);
				active_loop_iters[active_loop_iters.length - 1]++;
			}
		}
		return envs2;
	}

	// helper function copied from `RTVDisplay.ts`
	private bringToLoopCount(envs: any[], active_loop_iters: number[], loopId: string, iterCount: number) {
		while (active_loop_iters[active_loop_iters.length - 1] < iterCount) {
			envs.push({ '#': active_loop_iters.join(','), '$': loopId });
			active_loop_iters[active_loop_iters.length - 1]++;
		}
	}
}
