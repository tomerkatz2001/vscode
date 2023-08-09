import * as assert from "assert";



enum env_status{pass, fail, live}
/**
 * class that represents a block of examples, aka a comment, inserted automatically by the synth or manually by the user
 */

export class ParsedComment{
	get commentID(): number {
		return this._commentID;
	}

	set commentID(value: number) {
		this._commentID = value;
	}
	get lineno(): number {
		return this._lineno;
	}

	set lineno(value: number) {
		this._lineno = value;
	}
	synthesizedVarNames: string[] = []; //
	private readonly envs : any[] =[];
	private readonly envs_status :env_status[] =[]; //
	out : {[varName: string]: string}[] = []; //right of the "=>"
	private _commentID:number = -1;
	size: number; // number of line envs
	private _lineno: number = -1;
	private preEnvs?: Map<number, any>; // initialized after calling getEnvsToResynth.
	constructor(synthesizedVarNames: string[], envs: any[], envs_status: env_status[], out: any[],){
		this.synthesizedVarNames = synthesizedVarNames;
		this.envs = envs;
		this.envs_status = envs_status;
		this.out = out;
		for (let o of out) {
			for (let [key, value] of Object.entries(o)) {
				if (typeof value === "string") {
					o[key] = `'${value}'`;
				}
				else {
					o[key] = String(value);
				}
			}
		}
		this.size = envs.length;
	}
	get inVarNames(){
		// assume that the first env all vars, and all other vars are the same
		return Object.keys(this.envs[0]).map((v)=>v.replace("_in",""));
	}

	get outVarNames(){
		return Object.keys(this.out[0]);
	}
	public getEnvsToResynth(){
		let preEnvs: Map<number, any> = new Map<number, any>();
		let preEnv:any = {};
		let envs = [];
		for(let [i, env] of enumerate(this.envs)){
			let tmp = env;
			for(let varName in tmp){
				if(varName.endsWith("_in")){
					if(typeof env[varName] !== "string"){
						preEnv[varName.replace("_in", "")] = env[varName].toString();
					}
					else if(!tmp[varName].startsWith("[")){
						preEnv[varName.replace("_in", "")] = `'${env[varName]}'`;
					}
					else{
						preEnv[varName.replace("_in", "")] = env[varName];
					}
					delete env[varName];
				}
				//if the var is not string, make it a string
				else if(typeof tmp[varName] !== "string"){
					tmp[varName] = tmp[varName].toString();
				}
				else if(!tmp[varName].startsWith("[")){// if the var is string and not arr add another quote
					tmp[varName] = `'${tmp[varName]}'`;
				}
			}
			if(!tmp["#"]){
				tmp["#"] = "";
				tmp['time'] = -i;
			}
			else{
				tmp['time'] = parseInt(tmp["#"]);
			}
			if(!tmp["$"]){
				tmp["$"] = "";
			}

			// make each elemnt in the list a string
			envs.push({...tmp, ... this.out[i]});
			if(preEnv){
				preEnvs.set(parseInt(tmp["time"]), {...preEnv, ...tmp});
				preEnv = {};
			}
		}
		this.preEnvs = preEnvs;
		return envs;
	}

	public getPreEnvsToResynth(){
		console.assert(this.preEnvs);
		return this.preEnvs;
	}

	public toJson(){
		return {
			"outputVarNames": this.synthesizedVarNames,
			"commentExamples": this.getEnvsToResynth(),
			"assignments": {},
			"commentId": this._commentID
		};
	}
	public removeEnv(envIdx:number){
		this.envs.splice(envIdx,1);
		this.out.splice(envIdx,1);
	}

	public getEnvStatus(envIdx:number){
		assert(this.envs_status.length > envIdx,);
		return this.envs_status[envIdx];
	}

	public asString():string{
		//todo: replace to somthing that calls convert to string
		let s:string = "";
		let examplesCounter:number = 0;
		for (let [index,example] of this.envs.entries()) {
			let leftSide = `#! ${++examplesCounter}) `;
			Object.keys(example).forEach((inputVar) => {
				if(! ["#", "$", "time"].includes(inputVar)) {
					leftSide += `${inputVar} = ${example[inputVar]}, `;
				}
			});
			leftSide = leftSide.substring(0, leftSide.length - 2); //remove the last ', '

			let rightSide = ``;
			Object.keys(this.out[index]).forEach((outputVar) => {
				rightSide += `${outputVar} = ${this.out[index][outputVar]}, `; // add the output vars
			});
			rightSide = rightSide.substring(0, rightSide.length - 2); //remove the last ', '

			s += `${leftSide} => ${rightSide} \n`
		}
		return s;
	}
}

function enumerate<T>(a:T[]){
	return a.map((value, index)=> [index, value] as const);
}
