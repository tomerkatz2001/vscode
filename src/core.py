import re

magic_var_name = "__run_py__"

def strip_comment(str):
    return re.sub(r'#.*', '', str)

def strip_comments(lines):
    for i in range(len(lines)):
        lines[i] = strip_comment(lines[i])

def replace_empty_lines_with_noop(lines):

    curr_indent = -1
    curr_indent_str = ""
    for i in range(len(lines)):
        line = lines[i]
        stripped = line.strip()
        if stripped == "":
            if curr_indent != -1:
                lines[i] = curr_indent_str + "    "
        elif stripped[-1] == ":":
            curr_indent = len(line) - len(line.lstrip())
            curr_indent_str = line[0:curr_indent]
        else:
            curr_indent = -1

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
            # note: we cannot use pass here because the Python Debugger
            # Framework (bdb) does not stop at pass statements
            lines[i] = ws + magic_var_name + " = 0\n"
        else:
            ws_len = len(line) - len(line.lstrip())
            ws_computed = line[0:ws_len]

def load_code_lines(file_name):
    with open(file_name) as f:
        lines = f.readlines()
    strip_comments(lines)
    replace_empty_lines_with_noop(lines)
    return lines
