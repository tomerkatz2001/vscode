module os {
	export const EOL: string = '\n';

	export function tmpdir(): string {
		return '/tmp';
	}
}

module fs {
	export function writeFileSync(file: string, content: string): void {

	}

	export function appendFileSync(file: string, content: string) {

	}

	export function readFileSync(file: string): string {
		return '';
	}

	export function mkdirSync(dir: string): void {

	}

	export function existsSync(dir: string): boolean {
		return true;
	}
}

module path {
	export const sep: string = '/';
}

module cp {
	interface OutputStream {
		on(event: string, handler: (...msg: any[]) => void): void;
	}

	export class Process implements OutputStream {
		stdout: OutputStream;
		stderr: OutputStream;

		constructor() {
			this.stdout = {
				on(event: string, handler: (msg: string) => void): void {

				}
			};

			this.stderr = {
				on(event: string, handler: (msg: string) => void): void {

				}
			};
		}

		public on(event: string, handler: (...msg: any[]) => void): void {

		}

		public kill(): void {

		}
	}

	export function spawn(program: string, args: string[]): Process {
		return new Process();
	}
}

module process {
	export const env: { [key: string]: string } = {};
}

interface Timer {
}

function clearTimeout(t: Timer): void {

}

function setTimeout(handler: (...args: any[]) => void, delay: Number): Timer {
	return 0;
}

export { os, fs, path, cp, process, Timer, clearTimeout, setTimeout };
