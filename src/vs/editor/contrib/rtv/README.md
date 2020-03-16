# RTV
RTV is a projection model that projects the details of local, automatic variables, inputs, and outputs in a boxed modal.

## How to develop RTV
There are few requirements before you could develop for RTV

1. Node JS 12.14+
2. Python 3 preferably 3.6.*
3. npm
4. yarn (this could be installed using npm)

Once you satisfy the requierments please follow the next steps to setup your environment

1. type `yarn install` in the vscode directory
2. Then open the vscode dircetory using your own VS Code local installation (you could download it online if you don't have one installed)
3. In the `launch.json` under .vscode directory set the following env variables under `Launch VS Code`
```
PYTHON3: path to your python3 binary
RUNPY: absolute path to the run.py under src directory
SYNTH: absolute path to the jar file of scala synthesizer
SCALA: path to your scala interpreter
```
4. Then press `CTRL + SHIFT + B` or `CMD + SHIFT + B` on mac and run with `Launch VS Code` to build the configuration

If everything goes well you should be able to open a python file with extension .py and see the projection boxes


## How the synthesizer gets called
The synthesizer is called within the `synthesizeFragment` function in the `RTVDisplay.ts` file
