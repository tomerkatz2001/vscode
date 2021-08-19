import { TableElement, isHtmlEscape } from 'vs/editor/contrib/rtv/RTVUtils';


// core logic, Your Controller will call this layer's objects to get or update Models, or other requests.

/**
 * boxContent = {
 * 		<var>: [
* 					{
* 						<val>: <editable>
* 					},
* 					...
 * 				],
 * 		...
 * 		}
 */
export class RTVSynthService {
	private _allEnvs: any[];
	private _prevEnvs?: Map<number, any>;
	private _boxEnvs: any[] = [];
	private _boxVars: Set<string> = new Set<string>();
	// private _boxContent?: Map<string, Map<TableElement, number>[]>;
	private _lineNumber?: number;
	private _rowsValid: boolean[] = []; // to delete
	private _includedTimes: Set<number> = new Set();
	private _varnames?: string[]
	private _rows?: TableElement[][];
	private onBoxContentChanged?: Function;

	constructor(
	) {
		this._allEnvs = [];
	}

	get boxEnvs(): any[] {
		return this._boxEnvs;
	}

	get includedTimes(): Set<number> {
		return this._includedTimes;
	}

	bindBoxContentChanged(callback: Function) {
		this.onBoxContentChanged = callback;
	}

	_commit() {
		this.onBoxContentChanged!(
			{
				'rows': this._rows,
				'includedTimes': this._includedTimes,
				'boxEnvs': this._boxEnvs
			});
	}

	public updateBoxContent(newEnvs: any, outputVars?: string[], prevEnvs?: Map<number, any>) {
		this._varnames = outputVars!;
		this.updateBoxEnvs(newEnvs, prevEnvs);
		this.updateRowsValid();
	}


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
	 * @param prevEnvs
	 */
	public updateBoxEnvs(newEnvs: any[], prevEnvs?: Map<number, any>) {

		let outVarNames: string[];
		if (!this._varnames) {
			outVarNames = [];
		} else {
			outVarNames = this._varnames!;
		}

		// TODO: currently only works for single var assignment (broken for loops)
		this._boxEnvs = this.computeEnvs(newEnvs);
		let envs = this._boxEnvs;
		let vars = this._boxVars;

		if (prevEnvs) {
			const oldVars = vars;
			vars = new Set();
			for (const v of oldVars) {
				// remove any variables newly defined by the synthsizer
				let rs = true;
				if (outVarNames.includes(v)) {
					for (const env of envs) {
						const time = env['time'];
						const prev = prevEnvs.get(time);
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

		let rows: TableElement[][] = [];
		// Generate all rows
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			let loopID = env['$'];
			let iter = env['#'];
			let row: TableElement[] = [];
			vars.forEach((v: string) => {
				let v_str: string;
				let varName = v;
				let varEnv = env;

				if (outVarNames.includes(v)) {
					varName += '_in';
					if (prevEnvs && prevEnvs.has(env['time'])) {
						varEnv = prevEnvs.get(env['time']);
					}
				}

				if (varEnv[v] === undefined) {
					v_str = '';
				} else if (isHtmlEscape(varEnv[v])) {
					v_str = varEnv[v];
				} else {
					v_str = '```python\n' + varEnv[v] + '\n```';
				}

				row.push(new TableElement(v_str, loopID, iter, this._lineNumber!, varName, varEnv));
			});
			outVarNames.forEach((v: string, i: number) => {
				let v_str: string;
				if (env[v] === undefined) {
					v_str = '';
				} else if (isHtmlEscape(env[v])) {
					v_str = env[v];
				} else {
					v_str = '```python\n' + env[v] + '\n```';
				}
				row.push(new TableElement(v_str, loopID, iter, this._lineNumber!, v, env, i === 0));
			});
			rows.push(row);
		}

		this._rows = rows;

	}

	public updateRowsValid() {
		const boxEnvs = this._boxEnvs;
		if (boxEnvs.some(env => Object.keys(env).length <= 2)) {
			// We have empty rows, so we must be inside a conditional :(
			// Any non-empty row is valid here, since this counts as small-step.
			this._rowsValid = boxEnvs.map((env, _) => Object.keys(env).length > 2);
		} else {
			this._rowsValid = boxEnvs.map((env, i) => {
				let time;
				let rs = false;
				if (env) {
					time = env['time'];
					rs = !env['#'] ||
						env['#'] === '0' ||
						(i > 0 && this._includedTimes.has(boxEnvs[i - 1]['time']));
				}

				// This row is no longer valid. Remove it from the included time!
				if (!rs && this._includedTimes.has(time)) {
					this._includedTimes.delete(time);
					// SynthDisplay will remove highlight as necessary when updating the box content
					// this.removeHighlight(this.findParentRow(this.box!.getCell(this.varnames![0], i)!));
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

		const outputVars: Set<string> = new Set(this._varnames!);
		const rows = this._rows!;
		for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
			const row = rows[rowIdx];
			for (let _colIdx = 0; _colIdx < row.length; _colIdx++) {
				const cellVar = row[_colIdx].vname!;
				if (outputVars.has(cellVar)) {
					if (this._rowsValid[rowIdx]) {
						row[_colIdx].editable = true;
					}
				}
			}
		}
	}


	public computeEnvs(allEnvs: any[]) : any[]{
		// Get all envs at this line number
		let envs;
		envs = allEnvs[this._lineNumber!-1];
		envs = this.addMissingLines(envs);
		return envs;
	}


	// copied from `RTVDisplay.ts`
	private addMissingLines(envs: any[]): any[] {
		let last = function <T>(a: T[]): T { return a[a.length - 1]; };
		let active_loop_iters: number[] = [];
		let active_loop_ids: string[] = [];
		let envs2: any[] = [];
		for (let i = 0; i < envs.length; i++) {
			let env = envs[i];
			if (env.begin_loop !== undefined) {
				if (active_loop_iters.length > 0) {
					let loop_iters: string[] = env.begin_loop.split(',');
					this.bringToLoopCount(envs2, active_loop_iters, last(active_loop_ids), +loop_iters[loop_iters.length - 2]);
				}
				active_loop_ids.push(env['$']);
				active_loop_iters.push(0);
			} else if (env.end_loop !== undefined) {
				let loop_iters: string[] = env.end_loop.split(',');
				this.bringToLoopCount(envs2, active_loop_iters, last(active_loop_ids), +last(loop_iters));
				active_loop_ids.pop();
				active_loop_iters.pop();
				active_loop_iters[active_loop_iters.length - 1]++;
			} else {
				let loop_iters: string[] = env['#'].split(',');
				this.bringToLoopCount(envs2, active_loop_iters, last(active_loop_ids), +last(loop_iters));
				envs2.push(env);
				active_loop_iters[active_loop_iters.length - 1]++;
			}
		}
		return envs2;
	}

	// copied from `RTVDisplay.ts`
	private bringToLoopCount(envs: any[], active_loop_iters: number[], loopId: string, iterCount: number) {
		while (active_loop_iters[active_loop_iters.length - 1] < iterCount) {
			envs.push({ '#': active_loop_iters.join(','), '$': loopId });
			active_loop_iters[active_loop_iters.length - 1]++;
		}
	}
}
