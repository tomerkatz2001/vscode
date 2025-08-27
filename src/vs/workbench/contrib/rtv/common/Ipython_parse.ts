import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IPythonParserService {
	readonly _serviceBrand: undefined;

	findVariableNames(code: string): Promise<string[]>;
}
export const IPythonParserService = createDecorator<IPythonParserService>('pythonParserService');
