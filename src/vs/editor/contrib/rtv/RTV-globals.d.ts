export { };

declare global {
	interface Window {
		myUtils: {
			getOSEnvVariable: (key: string) => string;
			isLoopy: () => boolean;
			getUtils: () => {
				EOL: string;
				logger: (editor: any) => any;
				runProgram: (program: string, cwd?: string, values?: any) => any;
				runImgSummary: (program: string, line: number, varname: string) => any;
				runCommentsParser: (program: string) => any;
				validate: (input: string) => Promise<string | undefined>;
				synthesizer: () => any;
				resynthesizer: () => any;
			};
		};
	}
}
