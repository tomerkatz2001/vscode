import { Process } from 'vs/editor/contrib/rtv/RTVInterfaces';
import { RTVLogger } from 'vs/editor/contrib/rtv/RTVLogger';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';

/**
 * Declared interface to Pyodide. This only exists in the frontend, not here.
 * This interface allows some typechecking, and supresses error messages.
 */
interface Pyodide {
	loadPackage(names: [string], messageCallback?: (msg: string) => void, errorCallback?: (msg: string) => void): Promise<any>;
	loadPackages: {[packageName: string]: any};
	globals: any,
	repr(obj: any): string;
	runPython(code: string): any;
	runPythonAsync(code: string , messageCallback?: (msg: string) => void, errorCallback?: (msg: string) => void): Promise<any>;
	version(): string;
}

declare const pyodide: Pyodide;
declare const languagePluginLoader: Promise<any>;

let pyodideLoaded = false;
languagePluginLoader.then(() => {
	// pyodide is now ready to use...
	pyodideLoaded = true;
});


/**
 * interface for the output of the
 */
interface RunpyResponseData {
	success: boolean;
	stderr?: string;
	stdout?: string;
	result?: string;
}


class RunpyProcess implements Process {
	constructor(private request: Promise<string>) { }

	onStdout(fn: (data: any) => void): void {
		this.request.then(
			async (json: string) => {
				const data: RunpyResponseData = JSON.parse(json);
				fn(data.stdout);
			}
		);
	}

	onStderr(fn: (data: any) => void): void {
		this.request.then(
			async (json: string) => {
				const data: RunpyResponseData = JSON.parse(json);
				fn(data.stderr);
			}
		);
		this.request.catch(fn);
	}

	kill() {
		console.error('RunpyProcess.kill() called, but can\'t kill a Promise...');
	}

	onExit(fn: (exitCode: any, result?: string) => void): void {
		this.request.then(
			async (json: string) => {
				const data: RunpyResponseData = JSON.parse(json);
				fn(data.success ? 0 : 1, data.result);
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
	while (!pyodideLoaded) {}

	const csrfInput = document.getElementById('csrf-parameter') as HTMLInputElement;
	const csrfHeaderName = csrfInput.name;
	const csrfToken = csrfInput.value;

	const headers = new Headers();
	headers.append('Content-Type', 'text/plain;charset=UTF-8');
	headers.append(csrfHeaderName, csrfToken);

	// Get the 'run.py' file.
	// TODO Should we just bake it in?
	let runpy: string = '';
	fetch(
		'/editor/runpy',
		{
			method: 'GET',
			mode: 'same-origin',
			headers: headers,
		}).
		then(async (respo: Response) => {
			runpy = await respo.text();
		});

	while(runpy === '') {
		// TODO Busy loop
	}

	const pythonProgram = pyodide.repr(program);
	const finalProgram = `${runpy}\nmain(${pythonProgram})\n`;

	return new RunpyProcess(pyodide.runPythonAsync(finalProgram));
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
