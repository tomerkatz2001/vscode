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
        self.active_loops = []

    def data_at(self, l):
        if not(l in self.data):
            self.data[l] = []
        return self.data[l]

    def user_line(self, frame):
        # print("user_line ============================================")
        # print(frame.f_code.co_name)
        # print(frame.f_code.co_names)
        # print(frame.f_code.co_filename)
        # print(frame.f_code.co_firstlineno)
        # print(dir(frame.f_code))
        # print("lineno")
        # print(frame.f_lineno)
        # print(frame.__dir__())
        # print("globals")
        # print(frame.f_globals)
        # print("locals")
        # print(frame.f_locals)

        if frame.f_code.co_name == "<module>" or frame.f_code.co_name == "<listcomp>" or frame.f_code.co_filename != "<string>":
            return

        adjusted_lineno = frame.f_lineno-1
        print("---------------------------------------")
        print("About to execute: " + lines[adjusted_lineno].strip())
        self.record_loop_end(frame, adjusted_lineno)
        self.record_env(frame, adjusted_lineno)
        self.record_loop_begin(frame, adjusted_lineno)

    def record_loop_end(self, frame, lineno):
        curr_stmt = lines[lineno]
        if self.prev_env != None and len(self.active_loops) > 0 and self.active_loops[-1].frame is frame:
            prev_lineno = self.prev_env["lineno"]
            if isinstance(prev_lineno, str):
                prev_lineno = int(prev_lineno[1:])
            prev_stmt = lines[prev_lineno]
            if is_loop_str(prev_stmt):
                loop_indent = self.active_loops[-1].indent
                curr_indent = indent(curr_stmt)
                if (curr_indent <= loop_indent):
                    for l in self.stmts_in_loop(prev_lineno):
                        self.data_at(l).append({"end_loop":self.active_loops_str()})
                    del self.active_loops[-1]
                    #del self.data[prev_lineno][-1]

    def record_loop_begin(self, frame, lineno):
        for l in self.active_loops:
            print("Active loop at line " + str(l.lineno) + ", iter " + str(l.iter))
        curr_stmt = lines[lineno]
        if is_loop_str(curr_stmt):
            if len(self.active_loops) > 0 and self.active_loops[-1].lineno == lineno:
                self.active_loops[-1].iter += 1
            else:
                self.active_loops.append(LoopInfo(frame, lineno, indent(curr_stmt)))
                for l in self.stmts_in_loop(lineno):
                    self.data_at(l).append({"begin_loop":self.active_loops_str()})

            # in_another_loop = None
            # for l in range(lineno+1, len(lines)):
            #     line = lines[l]
            #     if line.strip() == "":
            #         continue
            #     if in_another_loop != None:
            #         if indent(curr_stmt) <= in_another_loop:
            #             in_another_loop = None
            #     if indent(line) <= indent(curr_stmt):
            #         break

            #     if not(l in self.data):
            #         self.data[l] = []
            #     self.data[l].append({})

            #     if is_loop_str(line):
            #         in_another_loop = indent(line)


    #
    def stmts_in_loop(self, lineno):
        result = []
        curr_stmt = lines[lineno]
        loop_indent = indent(curr_stmt)
        for l in range(lineno+1, len(lines)):
            line = lines[l]
            if line.strip() == "":
                continue
            if indent(line) <= loop_indent:
                break
            result.append(l)
        return result


    def active_loops_str(self):
        return ",".join([str(l.iter) for l in self.active_loops])

    def record_env(self, frame, lineno):
        if self.time >= 100:
            self.set_quit()
            return
        env = {}
        env["time"] = self.time
        env["loops"] = self.active_loops_str()
        self.time = self.time + 1
        for k in frame.f_locals:
            if k != magic_var_name:
                env[k] = repr(frame.f_locals[k])
        env["lineno"] = lineno

        self.data_at(lineno).append(env)

        if (self.prev_env != None):
            self.prev_env["next_lineno"] = lineno
            env["prev_lineno"] = self.prev_env["lineno"]

        self.prev_env = env




    def user_return(self, frame, rv):
        # print("user_return ============================================")
        # print(frame.f_code.co_name)
        # print("lineno")
        # print(frame.f_lineno)
        # print(frame.__dir__())
        # print("globals")
        # print(frame.f_globals)
        # print("locals")
        # print(frame.f_locals)

        if frame.f_code.co_name == "<module>" or frame.f_code.co_name == "<listcomp>" or frame.f_code.co_filename != "<string>":
            return

        adjusted_lineno = frame.f_lineno-1
        print("About to return: " + lines[adjusted_lineno].strip())
        self.record_loop_end(frame, adjusted_lineno)
        self.record_env(frame, "R" + str(adjusted_lineno))
        self.record_loop_begin(frame, adjusted_lineno)

    def pretty_print_data(self):
        for k in self.data:
            print("** Line " + str(k))
            for env in self.data[k]:
                print(env)

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

def is_loop_str(str):
    return re.search("(for|while).*:", str.strip()) != None

def indent(str):
    return len(str) - len(str.lstrip())

class LoopInfo:
    def __init__(self, frame, lineno, indent):
        self.frame = frame
        self.lineno = lineno
        self.indent = indent
        self.iter = 0


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
    l.pretty_print_data()

    with open(sys.argv[1] + ".out", "w") as out:
        out.write(json.dumps((rwc.data,l.data)))

#    ic = InsertCollector()
#    ic.visit(root)

main()