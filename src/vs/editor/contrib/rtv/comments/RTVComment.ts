import * as assert from "assert";
enum env_status{pass, fail, live}
/**
 * class that represents a block of examples, aka a comment, inserted automatically by the synth or manually by the user
 */

export class ParsedComment{
	synthesizedVarNames: string[] = []; //
	private readonly envs : any[] =[];
	private readonly envs_status :env_status[] =[]; //
	out : {[varName: string]: string}[] = []; //right of the "=>"
	commentID:number = 0;
	size: number; // number of line envs
	constructor(synthesizedVarNames: string[], envs: any[], envs_status: env_status[], out: any[], commentID:number,){
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
		this.commentID = commentID;
		this.size = envs.length;
	}

	public getEnvsToResynth(){
		let envs = [];
		for(let [i, env] of enumerate(this.envs)){
			let tmp = env;
			for(let varName in tmp){
				if(varName.endsWith("_in")){
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
			}
			if(!tmp["$"]){
				tmp["$"] = "";
			}
			tmp['time'] = -1;
			// make each elemnt in the list a string
			envs.push({...tmp, ... this.out[i]});
		}
		return envs;
	}

	public toJson(){
		return {
			"outputVarNames": this.synthesizedVarNames,
			"commentExamples": this.getEnvsToResynth(),
			"assignments": {},
			"commentId": this.commentID
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
