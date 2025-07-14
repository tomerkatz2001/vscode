import { IPythonParserService } from '../common/python_parse.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createVisitor, parse, TfpdefContext } from 'python-ast';



export class PythonParserService implements IPythonParserService {
	findVariableNames(code: string): string[] {
		const tree = parse(code);
		let vars: string[] = []

		let TfpdefVisitor = (ctx: TfpdefContext) => {
			vars.push(ctx.getChild(0).toString());
		};

		createVisitor({ visitTfpdef: TfpdefVisitor }).visit(tree);
		return vars;
	}
}

registerSingleton(IPythonParserService, PythonParserService, InstantiationType.Eager);
