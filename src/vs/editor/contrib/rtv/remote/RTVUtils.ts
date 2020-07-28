import { Process } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { RTVLogger } from 'vs/editor/contrib/rtv/RTVLogger';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

/**
 * Declared interface to Pyodide. This only exists in the frontend, not here.
 * This interface allows some typechecking, and supresses error messages.
 */
interface Pyodide {
	loadPackage(names: string|[string], messageCallback?: (msg: string) => void, errorCallback?: (msg: string) => void): Promise<any>;
	loadPackages: {[packageName: string]: any};
	globals: any,
	repr(obj: any): string;
	runPython(code: string): any;
	runPythonAsync(code: string , messageCallback?: (msg: string) => void, errorCallback?: (msg: string) => void): Promise<any>;
	version(): string;
}

declare const pyodide: Pyodide;
declare const languagePluginLoader: Promise<any>;
declare const window: { 'editor': ICodeEditor };

let pyodideLoaded = false;
languagePluginLoader.then(() => {
	// pyodide is now ready to use...

	// TODO This loads the package from Pyodide servers, not ours.
	pyodide.loadPackage('numpy');
	pyodideLoaded = true;
	// RTVController.get(window.editor).runProgram();
});


/**
 * interface for the output of the
 */
/* interface RunpyResponseData {
	success: boolean;
	stderr?: string;
	stdout?: string;
	result?: string;
} */


class RunpyProcess implements Process {
	private request: Promise<string | void>;
	private progress: string = '';
	private error: string = '';
	private onProgress: undefined | ((data: any) => void) = undefined;
	private onError: undefined | ((data: any) => void) = undefined;

	constructor(program: string) {
		this.request = pyodide.runPythonAsync(
			program,
			(message: string) => {
				this.progress += `${message}\n`;
			},
			(error: string) => {
				this.error += `${error}\n`;
			})
		.then(() => {
			if (this.onError && this.error) {
				this.onError(this.error);
			}

			if (this.onProgress && this.progress) {
				this.onProgress(this.progress);
			}
		})
		.catch((error) => {
			this.error = error;
			if (this.onError) {
				this.onError(this.error);
			}
		});
	}

	onStdout(fn: (data: any) => void): void {
		this.onProgress = fn;
	}

	onStderr(fn: (data: any) => void): void {
		this.onError = fn;
		this.request.catch(fn);
	}

	kill() {
		// console.error('RunpyProcess.kill() called, but can\'t kill a Promise...');
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.request.then(
			() => {
				const out = pyodide.runPython(
					'import os\n' +
					'if os.path.exists("program.py.out"):\n' +
					'\tfile = open("program.py.out")\n' +
					'\trs = file.read()\n' +
					'\tos.remove("program.py.out")\n' +
					'else:\n' +
					'\t rs = ""\n' +
					'rs');
				const code: Number = (out === '') ? 1 : 0;
				fn(code, out);
			}
		);
	}
}

class SynthProcess implements Process {
	onStdout(fn: (data: any) => void): void {
		// TODO
	}

	onStderr(fn: (data: any) => void): void {
		// TODO
	}

	kill() {
		// TODO
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		// TODO
	}
}


export function runProgram(program: string): Process {
	if (!pyodideLoaded) {
		// @Hack: We want to ignore this call until pyodide has loaded.
		return new SynthProcess();
	}

	while (program.includes('"""')) {
		program = program.replace('"""', '\\"\\"\\"');
	}

	// TODO Cache run.py

	const saveFiles = 'import pyodide\n' +
		'runpy = open("run.py", "w")\n' +
		'runpy.write(pyodide.open_url("/editor/runpy").getvalue())\n' +
		'runpy.close()\n' +
		'program = """' + program + '"""\n' +
		'code = open("program.py", "w")\n' +
		'code.write(program)\n' +
		'code.close()\n';
	const runPy = 'run = open("run.py", "r")\npyodide.eval_code(run.read() + "\\nmain(\'program.py\')\\n", {})\n';

	pyodide.runPython(saveFiles);

	return new RunpyProcess(runPy);
}

export function synthesizeSnippet(problem: string): Process {
	return new SynthProcess();
}

export function runImgSummary(program: string, line: number, varname: string) {
	// TODO Implement!
	return new SynthProcess();
}

export function getLogger(editor: ICodeEditor): RTVLogger {
	return new RTVLogger(editor);
}

// Assuming the server is running on a unix system
export const EOL: string = '\n';
