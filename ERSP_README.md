# Visual Studio Code + Projection Boxes

## Table of Content
1. [How to Fork this repository](#how-to-fork-this-repository)
2. [How to set up locally](#how-to-set-up-locally)
   1. [Prerequisites](#prerequisites)
   2. [Windows](#windows)
   3. [MacOS](#mac)
   4. [Linux](#linux)
3. [Building and Running](#building-and-running)
   1. [Visual Studio Code](#visual-studio-code)
   2. [Terminal](#terminal)

## How to Fork this repository

The current repository is owned by the [UCSD PL](https://github.com/UCSD-PL/) group, but for this project (to give you more freedom to change the structure if you want, and since it's good practice anyway) you should work on a _fork_ of this repository.

A Fork is basically a copy of a repository that you own, and you can modify as you please, but which is still related to the original (usually called _upstream_) repository, letting you create _Pull Requests_ to merge the work on your fork back into upstream.

Since this is a group project, we recommend _one_ of you create a Fork of the repo, and give the others admin access. Then everyone can follow the instructions below to clone the repo to your machines and work on it together.

To fork the repo, one of you (who is willing to take responsibility for the code) should:

1. Navigate to the [UCSD-PL VSCode Repository](https://github.com/UCSD-PL/vscode) while logged in to GitHub.
2. Click the `Fork` button on the top right of the page.
3. Go to their fork of the repo: `https://github.com/<USERNAME>/vscode`
4. Click on `Settings` near the top right of the page
5. Select `Manage Access` on the menu on the left (You might have to type your password again here)
6. Use the `Add People` button to add the others by their email or GitHub username to this repo and give them Admin access.

## How to set up locally

### Prerequisites
To set up `vscode` for local development, you will first need to install the following:

1. [Git](https://git-scm.com/)
2. [Python 3](https://www.python.org/)
3. [NodeJS](https://nodejs.org/en/) (version 14)
4. [Yarn](https://yarnpkg.com/)

How to install them depends on your operating system and how you prefer managing your
software/package installations. We have some suggestions for [Windows](#windows), [MacOS](#Mac)
and [Linux](#linux) below.

### Windows
You can download the Installers from each software's website, and make sure [they are on your PATH](https://www.howtogeek.com/118594/how-to-edit-your-system-path-for-easy-command-line-access/).

Alternatively, you can use a Package Manager such as [Chocolatey](https://chocolatey.org/) to handle the installations for you. For instance, after setting up Chocolatey, you can install them by opening an Administrative Powershell terminal, and typing:
```
choco install git
choco install python
choco install nodejs-lts --version=14.18.1
choco install yarn
```

### Mac

#### Homebrew (recommended)

Homebrew is a package manager for macOS (and Linux). It makes package installations easier. It is recommended, but not required, that you have Homebrew installed for the installation of other dependencies required for this project. Of course, you may use other package managers such as [MacPorts](https://www.macports.org).

To install Homebrew, paste the following command into your Terminal:
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

#### Git

MacOS should already have `git` installed. To check whether your Mac comes with `git`, try:
```
git version
```
through the terminal.

If for any reason you don't have `git` installed, you can install the latest version of `git` from an installer or Homebrew, following the instructions on [this page](https://github.com/git-guides/install-git).

#### Python 3

_Using the Python 3 that comes with MacOS 10.15+_

Starting MacOS Catalina (10.15), a `/usr/bin/python3` binary is included, which is a stub for installing the command line developer tools that include Python 3. If you're not sure whether you have the command line developer tools and hence Python 3 already installed, you may try:
```
/usr/bin/python3 --version
```
in your Terminal and see if you get a version number (installed) or a prompt to install the command line developer tools (not yet installed). If you'd like to use the very Python 3 that comes with the OS, then you're good to go once you have the command line developer tools installed.

_Using your own Python 3_

If you prefer not to install Python 3 through the command line developer tools, then you may download an installer directly from [Python's website](https://www.python.org), or through a package manager, e.g., Homebrew by running:
```
brew install python3
```

#### NodeJS 14.8.1
14.8.1 is an LTS (long-term support) but not the most recent version of NodeJS. We are certain that NodeJS 14 (specifically, 14.8.1) works well with building this project. We're not sure about the newer versions of Node.

To install NodeJS 14.8.1, you may use Homebrew:
```
brew isntall node@14
```

After the installation, confirm the version of the installed NodeJS:
```
node --version
# output should be 14.8.1
```

#### Yarn

After you have NodeJS installed, you should have `npm` (the package manager for NodeJS) installed. To verify, type the following command in your Terminal:
```
npm -v
# output should be some version number
```

With `npm`, it's easy to install `yarn`. If you want to install `yarn` _globally_, i.e., enabling it to be used outside of this project, simply type the following command in your Terminal:
```
npm i -g yarn
```

However, if you only want to use `yarn` for this project, then you'll first change your working directory to be the absolute path of your `vscode` directory:
```
cd /Absolute/Path/To/vscode
```
then run:
```
npm i yarn
```



### Linux
This depends on your linux distribution, but almost all distributions will have these available through their package manager. For instance, in Archlinux, you can install these with:
```
pacman -S git python3 yarn nodejs-lts-fermium
```

## Building and Running
You can build and run `vscode` from the terminal using a provided script, or through a (normal non-projection-boxes) instance of [Visual Studio Code](https://code.visualstudio.com/). We recommend doing things through VS Code, both because it's slightly less OS-dependent, and because it's a fair bit nicer.

### Visual Studio Code
To build run with Visual Studio Code, open the `vscode` directory as a directory in Code (`File > Open Folder...`). The first time you open the project, you will see a message pop up (in the bottom right) about installing recommended Extensions. We _highly_ recommend you install these extensions, as it gives you better editing and debugging features.

You can install these at a later time in the `Recommended` tab of the `Extensions` window in Code.

#### Building

After all the extensions are installed, you can start a build _daemon_ by hitting `Ctrl/Cmd`+`Shift`+`B`.

> A _daemon_ is a background process that does something for you. In this case, the build daemon builds the code once, and then automatically rebuilds each time you make changes to the code. This makes sure that each time you run the code, you're running the most up-to-date version of it!

You should see a `Building...` message in the status bar at the bottom of the Code window. If you click it (or the wrench icon after it has finished building), and select `Build VS Code Core`, it will show the build logs which you can check for errors and other messages as you change the code!

Each time the project has been rebuilt, you should see a message like:
```
Finished compilation with 0 errors
```
in the build logs. If that number is greater than 0, you should fix the errors (printed above that line) before proceeding.

After you are done, you can stop the daemon by running the following in the terminal:

> **Note**: From now on it'll be the easiest if you work inside a Terminal opened within Visual Studio Code. To do so, go to the navigation bar and select `Terminal` -> `New Terminal`.

```
yarn kill-watch-extensionsd
yarn kill-watch-clientd
```

#### Environment Variables

We use a Visual Studio Code extension named `Command Variable` to set the necessary environment variables when running vscode inside of Visual Studio Code.
You should already have it installed if you have installed all the recommended extensions. If this is not the case, then go to the Extensions tab (the fifth buttom in your leftmost navigation bar) and search `Command Variable` to install it.

To set the variables for your machine, open the `.env` file in the root of this repo, and update each variable to the correct value for your system. You'll need to set the following environment variables using the format specified in the comment at the top of the `.env` file:
1. `SNIPPY_UTILS`: Absolute path to `vscode/src/snippy.py`
2. `RUNPY`: Absolute path to `vscode/src/run.py`
3. `IMGSUM`: Absolute path to `vscode/src/img-summary.py`
4. `SYNTH`: Absolute path to `synthesizer/target/snippy-server-0.1-SNAPSHOT-jar-with-dependencies.jar`. **NOTE:** Set this to empty (`''`) if not using synthesis.
5. `PYTHON3`: Absolute path to your `python3` executable.
(If not sure, check the output of `which python3` in your Terminal.)
6. `JAVA`: Absolute path to your `java` executable.
(If not sure, check the output of `which java` in your Terminal.)


#### Running
After successfully building `vscode` and setting up the environment variables, you can run it in Debug mode by pressing `F5`.
This should open `vscode` with Projection Boxes.

If you don't see Projection Boxes anywhere, make sure to open a Python `.py` file
and write some code first!

If you see an error message such as:
```
Error: OS environment variable PYTHON3 is not defined
```
you [environment variables](#environment-variables) are not configured correctly.

### Terminal (i.e., with a non-VS Code editor of your choice)

#### Building

After you have installed all the software dependencies, you can clone and build the project with the following commands:
```
git clone https://github.com/<USERNAME>/vscode
cd vscode
yarn
yarn compile
```
These may produce many warning messages, but no errors. If you see an error and not sure what it means or what to do about it, please contact Lisa or me and we can help you figure it out.

#### Running
Projection Boxes assume that the following environment variables are correctly defined:

1. `SNIPPY_UTILS`: Absolute path to `vscode/src/snippy.py`
2. `RUNPY`: Absolute path to `vscode/src/run.py`
3. `IMGSUM`: Absolute path to `vscode/src/img-summary.py`
4. `SYNTH`: Absolute path to `synthesizer/target/snippy-server-0.1-SNAPSHOT-jar-with-dependencies.jar`. **NOTE:** Set this to empty (`''`) if not using synthesis.
5. `PYTHON3`: Absolute path to your `python3` executable.
6. `JAVA`: Absolute path to your `java` executable.

For Windows, we recommend setting them as User-wide Environment Variables. You can follow [the same instructions as setting the PATH](https://www.howtogeek.com/118594/how-to-edit-your-system-path-for-easy-command-line-access/) for Windows, but instead of modifying an existing _System_ variable, _add_ these as new _User_ variables.

After these are set, you can run the editor with Projection Boxes using the following script:
```
.\scripts\code.bat
```

For MacOS and Linux, we recommend using the `run.sh` script in `vscode` directory. It sets the required environment
variables automatically, and starts up the editor with Projection Boxes:
```
./run.sh
```
