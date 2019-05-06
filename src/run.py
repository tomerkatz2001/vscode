import sys
import ast
import bdb
import json
import re

magic_var_name = "__run_py__"

def strip_comment(str):
    return re.sub(r'#.*', '', str)

class Logger(bdb.Bdb):
    def __init__(self):
        bdb.Bdb.__init__(self)
        self.time = 0
        self.prev_env = None
        self.data = {}
    def user_line(self, frame):
        if frame.f_globals["__name__"] != "__main__":
            return
        if "__name__" in frame.f_locals:
            return
        print("About to execute: " + lines[frame.f_lineno-1])
        self.record_env(frame, frame.f_lineno-1)
        #print("")
        # print(frame.__dir__())
        # print("globals")
        # print(frame.f_globals)

    def record_env(self, frame, adjusted_lineno):

        # print("locals:" + str(frame.f_locals))
        # print("lineno: " +  str(frame.f_lineno))
        env = {}
        env["time"] = self.time
        self.time = self.time + 1
        for k in frame.f_locals:
            if k != magic_var_name:
                env[k] = repr(frame.f_locals[k])
        env["lineno"] = adjusted_lineno

        if not(adjusted_lineno in self.data):
            self.data[adjusted_lineno] = []
        self.data[adjusted_lineno].append(env)

        if (self.prev_env != None):
            self.prev_env["next_lineno"] = adjusted_lineno
            env["prev_lineno"] = self.prev_env["lineno"]

        self.prev_env = env


    def user_return(self, frame, rv):
        if frame.f_globals["__name__"] != "__main__":
            return
        if "__name__" in frame.f_locals:
            return
        print("About to execute return: " + lines[frame.f_lineno-1])
        self.record_env(frame, "R" + str(frame.f_lineno-1))
        # print("locals:" + str(frame.f_locals))
        # print("lineno: " +  str(frame.f_lineno))
        # print("Rv: " + str(rv))

    def store_prev_env(self):
        lineno = self.prev_env["lineno"]
        if not(lineno in self.data):
            self.data[lineno] = []
        self.data[lineno].append(self.prev_env)
        # print(str(lineno) + "+" + json.dumps(self.prev_env))

class InsertPrint:
    def __init__(self, lineno, col_offset, name, ctx, before):
        self.lineno = lineno
        self.col_offset = col_offset
        self.name = name
        self.ctx = ctx
        self.before = before
    def __repr__(self):
        return str(self.lineno) + "," + str(self.col_offset) + "," + self.name + "," + str(self.before)

class RWCollector(ast.NodeVisitor):
    def __init__(self):
        ast.NodeVisitor()
        self.data = {}

    def addRW(self, node, ctx):
        key = str(node.lineno-1) + "," + str(node.col_offset)
        if isinstance(ctx, ast.Store):
            self.data[key] = "w"
        elif isinstance(ctx, ast.Load):
            self.data[key] = "r"
        else:
            print("Unknown context:", ctx)
            exit(-1)

    # def visit_FunctionDef(self, node):
    #     print("FunctionDef " + node.name + " @ line " + str(node.lineno) + " col " + str(node.col_offset))

    #     # node.lineno counts from 1, adjust to count from 0
    #     lineno = node.lineno-1

    #     # note: ignoring other fields of node.args like kwonlyargs (among others)
    #     for arg in node.args.args:
    #         self.addInsert(lineno+1, lineno, node.col_offset, arg.arg, ast.Store(), True)
    #     self.generic_visit(node)

    def visit_Name(self, node):
        print("Name " + node.id + " @ line " + str(node.lineno) + " col " + str(node.col_offset))
        self.addRW(node, node.ctx)

    def visit_arg(self, node):
        print("arg " + node.arg + " @ line " + str(node.lineno) + " col " + str(node.col_offset))
        self.addRW(node, ast.Store())

def find_colon_followed_by_empty(lines, start):
    lineno = start
    while (True):
        if (lineno < 0):
            return None
        if (lines[lineno].strip() == ""):
            lineno = lineno - 1
        if (lines[lineno].rstrip().endswith(":")):
            if (lineno+1 < len(lines)):
                return lineno+1
            else:
                return None


def main():
    global lines

    if len(sys.argv) != 2:
        print("Usage: run <file-name>")
        exit(-1)

    with open(sys.argv[1]) as f:
        lines = f.readlines()

    for i in range(len(lines)):
        lines[i] = strip_comment(lines[i])


    ws_computed = ""
    for i in range(len(lines)-1,0,-1):
        line = lines[i]
        if (line.strip() == ""):
            ws_len_user = len(line.rstrip('\n'))
            ws_len_computed = len(ws_computed)
            if ws_len_user > ws_len_computed:
                ws = line.rstrip('\n')
            else:
                ws = ws_computed
            lines[i] = ws + magic_var_name + " = 0\n"
        else:
            ws_len = len(line) - len(line.lstrip())
            ws_computed = line[0:ws_len]
    code = "".join(lines)
    print(code)
    root = ast.parse(code)

    # version 1
    # original_lines = [lines[i] for i in range(len(lines))]
    # ws = ""
    # for i in range(len(lines)-1,0,-1):
    #     line = lines[i]
    #     if (line.strip() == ""):
    #         lines[i] = ws + magic_var_name + " = 0\n"
    #     else:
    #         num_ws = len(line) - len(line.lstrip())
    #         ws = line[0:num_ws]

    # try:
    #     code = "".join(lines)
    #     print("First")
    #     print(code)
    #     root = ast.parse(code)
    # except SyntaxError as e:
    #     lineno = e.lineno-1 # adjust to count from 0
    #     if original_lines[lineno].strip() == "":
    #         lines[lineno] = original_lines[lineno].rstrip("\n") + magic_var_name + " = 0\n"
    #         code = "".join(lines)
    #         print("Second")
    #         print(code)
    #         root = ast.parse(code)

    # version 2
    # try:
    #     code = "".join(lines)
    #     print("First")
    #     print(code)
    #     root = ast.parse(code)
    # except SyntaxError as e:
    #     lineno = e.lineno-1 # adjust to count from 0
    #     lineno = lineno-1   # start one line before error
    #     fix_lineno = find_colon_followed_by_empty(lines, lineno)
    #     if (fix_lineno != None):
    #         lines[fix_lineno] = lines[fix_lineno].rstrip("\n") + magic_var_name + " = 0\n"
    #         code = "".join(lines)
    #         print("Second")
    #         print(code)
    #         root = ast.parse(code)

    # version 3
    # pass_lines = set()
    # for i in range(len(lines)):
    #     if lines[i].strip() == "":
    #         pass_lines.add(i)
    #         lines[i] = lines[i].rstrip('\n') + magic_var_name + " = 0\n"
    #         #lines[i] = lines[i].rstrip('\n') + "pass\n"

    # done = False
    # while not(done):
    #     try:
    #         code = "".join(lines)
    #         print(code)
    #         root = ast.parse(code)
    #         done = True
    #     except IndentationError as e:
    #         lineno = e.lineno-1
    #         if (lineno in pass_lines or (lineno-1) in pass_lines):
    #             pass_lineno = lineno if lineno in pass_lines else (lineno-1)
    #             next_line = lines[pass_lineno+1]
    #             num_ws = len(next_line) - len(next_line.lstrip())
    #             ws = next_line[0:num_ws]
    #             lines[pass_lineno] = ws + magic_var_name + " = 0\n"
    #             #lines[pass_lineno] = ws + "pass\n"
    #             pass_lines.remove(pass_lineno)
    #         else:
    #             done = True
    #         print(e.__class__)
    #         print(dir(e))
    #         print(e.lineno)
    #         print(e.text)

    print(ast.dump(root))
    rwc = RWCollector()
    rwc.visit(root)
    print(rwc.data)

    l = Logger()
    l.run(code)
    print(l.data)

    with open(sys.argv[1] + ".out", "w") as out:
        out.write(json.dumps((rwc.data,l.data)))

#    ic = InsertCollector()
#    ic.visit(root)

main()