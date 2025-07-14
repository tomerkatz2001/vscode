import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface IPythonParserService {
	findVariableNames(code: string): string[];
}
export const IPythonParserService = createDecorator<IPythonParserService>('pythonParserService');
