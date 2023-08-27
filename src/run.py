import ast
import bdb
import ctypes
import json
import os
import sys
import types

from core import *
from parse import *


# from PIL import Image

def add_html_escape(html):
	return f"```html\n{html}\n```"

def add_red_format(html):
	return f"<div style='color:red;'>{html}</div>"

def is_loop_str(str):
	return re.search("(for|while).*:\w*\n", str) != None

def is_break_str(str):
	return re.search("break", str.strip()) != None

def is_return_str(str):
	return re.search("return", str.strip()) != None

def indent(str):
	return len(str) - len(str.lstrip())

def remove_R(lineno):
	if isinstance(lineno, str):
		return int(lineno[1:])
	else:
		return lineno

class LoopInfo:
	def __init__(self, frame, lineno, indent):
		self.frame = frame
		self.lineno = lineno
		self.indent = indent
		self.iter = 0

	def __str__(self):
		return f'iter {self.iter}, frame {self.frame} at line {self.lineno} with indent {self.indent}'

class Logger(bdb.Bdb):
	def __init__(self, lines, writes, values = []):
		bdb.Bdb.__init__(self)
		self.lines = lines
		self.writes = writes
		self.time = 0
		self.prev_env = None
		self.data = {}
		self.active_loops = []
		self.preexisting_locals = None
		self.exception = None
		self.matplotlib_state_change = False

		# Optional dict from (lineno, time) to a dict of varname: value
		self.values = values

	def data_at(self, l):
		if not(l in self.data):
			self.data[l] = []
		return self.data[l]

	def user_call(self, frame, args):
		if not ("__name__" in frame.f_globals):
			return
		if frame.f_globals["__name__"] == "matplotlib.pyplot":
			self.matplotlib_state_change = True

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

		if frame.f_code.co_name == "<module>" and self.preexisting_locals == None:
			self.preexisting_locals = set(frame.f_locals.keys())

		if frame.f_code.co_name == "<listcomp>":
			return
		if frame.f_code.co_name == "<dictcomp>":
			return
		if frame.f_code.co_name == "<lambda>":
			return
		if not ("__name__" in frame.f_globals):
			return
		if frame.f_globals["__name__"] != "__main__":
			return
		# When __qualname__ exists as a local, it means we are executing
		# the method/field definitions inside a class, so we should
		# not process these.
		if "__qualname__" in frame.f_locals:
			return

		self.exception = None
		adjusted_lineno = frame.f_lineno-1
		self.record_loop_end(frame, adjusted_lineno)
		self.record_env(frame, adjusted_lineno)
		self.record_loop_begin(frame, adjusted_lineno)

	def record_loop_end(self, frame, lineno):
		curr_stmt = self.lines[lineno]
		if self.prev_env != None and len(self.active_loops) > 0 and self.active_loops[-1].frame is frame:
			prev_lineno = remove_R(self.prev_env["lineno"])
			prev_stmt = self.lines[prev_lineno]

			loop_indent = self.active_loops[-1].indent
			curr_indent = indent(curr_stmt)
			curr_frame_name = frame.f_code.co_name
			prev_frame_name = self.prev_env["frame"].f_code.co_name
			if is_return_str(prev_stmt) and curr_frame_name == prev_frame_name:
				# we shouldn't record the end of a loop after
				# a call to another function with a return statement,
				# so we need to check whether prev stmt comes from the same frame
				# as the current one
				while len(self.active_loops) > 0:
					self.active_loops[-1].iter += 1
					for l in self.stmts_in_loop(self.active_loops[-1].lineno):
						self.data_at(l).append(self.create_end_loop_dummy_env())
					del self.active_loops[-1]
			elif (curr_indent <= loop_indent and lineno != self.active_loops[-1].lineno):
				# break statements don't go through the loop header, so we miss
				# the last increment in iter, which is why we have to adjust here
				if is_break_str(prev_stmt):
					self.active_loops[-1].iter += 1
				for l in self.stmts_in_loop(self.active_loops[-1].lineno):
					self.data_at(l).append(self.create_end_loop_dummy_env())
				del self.active_loops[-1]

	def record_loop_begin(self, frame, lineno):
		# for l in self.active_loops:
		#	 print("Active loop at line " + str(l.lineno) + ", iter " + str(l.iter))
		curr_stmt = self.lines[lineno]
		if is_loop_str(curr_stmt):
			if len(self.active_loops) > 0 and self.active_loops[-1].lineno == lineno:
				self.active_loops[-1].iter += 1
			else:
				self.active_loops.append(LoopInfo(frame, lineno, indent(curr_stmt)))
				for l in self.stmts_in_loop(lineno):
					self.data_at(l).append(self.create_begin_loop_dummy_env())

	def stmts_in_loop(self, lineno):
		result = []
		curr_stmt = self.lines[lineno]
		loop_indent = indent(curr_stmt)
		for l in range(lineno+1, len(self.lines)):
			line = self.lines[l]
			if line.strip() == "":
				continue
			if indent(line) <= loop_indent:
				break
			result.append(l)
		return result

	def active_loops_iter_str(self):
		return ",".join([str(l.iter) for l in self.active_loops])

	def active_loops_id_str(self):
		return ",".join([str(l.lineno) for l in self.active_loops])

	def add_loop_info(self, env):
		env["#"] = self.active_loops_iter_str()
		env["$"] = self.active_loops_id_str()

	def create_begin_loop_dummy_env(self):
		env = {"begin_loop":self.active_loops_iter_str()}
		self.add_loop_info(env)
		return env

	def create_end_loop_dummy_env(self):
		env = {"end_loop":self.active_loops_iter_str()}
		self.add_loop_info(env)
		return env

	def compute_repr(self, v):
		if isinstance(v, types.FunctionType):
			return None
		if isinstance(v, types.ModuleType):
			return None
		if isinstance(v, type):
			return None
		html = if_img_convert_to_html(v)
		if html == None:
			try:
				return repr(v)
			except:
				return "Repr exception " + str(type(v))
		else:
			return add_html_escape(html)

	def record_env(self, frame, lineno):
		line_time = "(%s,%d)" % (lineno, self.time)
		if line_time in self.values:
			# Replace the current values with the given ones first
			print('%s:' % line_time)
			env = self.values[line_time]
			print(frame.f_locals)

			for varname in frame.f_locals:
				if varname in env:
					new_value = eval(env[varname])
					print("\t'%s': '%s' -> '%s'" % (varname, repr(frame.f_locals[varname]), repr(new_value)))
					frame.f_locals.update({ varname: new_value })
					ctypes.pythonapi.PyFrame_LocalsToFast(ctypes.py_object(frame), ctypes.c_int(0))

		if self.time >= 1000:
			self.set_quit()
			return
		env = {}
		env["frame"] = frame
		env["time"] = self.time
		self.add_loop_info(env)
		self.time = self.time + 1
		for k in frame.f_locals:
			if k != magic_var_name and (frame.f_code.co_name != "<module>" or not k in self.preexisting_locals):
				r = self.compute_repr(frame.f_locals[k])
				if (r != None):
					env[k] = r
		env["lineno"] = lineno

		if self.matplotlib_state_change:
			env["Plot"] = add_html_escape(matplotlib_fig_as_html())
			self.matplotlib_state_change = False

			if self.prev_env != None:
				prev_lineno = remove_R(self.prev_env["lineno"])
				if not (prev_lineno in self.writes):
					self.writes[prev_lineno] = []
				self.writes[prev_lineno].append("Plot")

		self.data_at(lineno).append(env)

		if (self.prev_env != None):
			self.prev_env["next_lineno"] = lineno
			env["prev_lineno"] = self.prev_env["lineno"]

		self.prev_env = env

	def user_exception(self, frame, e):
		self.exception = e[1]

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

		if frame.f_code.co_name == "<listcomp>":
			return
		if frame.f_code.co_name == "<dictcomp>":
			return
		if frame.f_code.co_name == "<lambda>":
			return
		if not ("__name__" in frame.f_globals):
			return
		if frame.f_globals["__name__"] != "__main__":
			return
		if "__qualname__" in frame.f_locals:
			return

		adjusted_lineno = frame.f_lineno-1

		self.record_env(frame, "R" + str(adjusted_lineno))
		if self.exception == None:
			r = self.compute_repr(rv)
			rv_name = "rv"
		else:
			html = add_red_format(self.exception.__class__ .__name__ + ": " + str(self.exception))
			r = add_html_escape(html)
			rv_name = "Exception Thrown"
		if r != None and (frame.f_code.co_name != "<module>" or self.exception != None):
			self.data_at("R" + str(adjusted_lineno))[-1][rv_name] = r
		self.record_loop_end(frame, adjusted_lineno)

	def pretty_print_data(self):
		for k in self.data:
			print("** Line " + str(k))
			for env in self.data[k]:
				print(env)


class WriteCollector(ast.NodeVisitor):
	def __init__(self):
		ast.NodeVisitor()
		self.data = {}

	def data_at(self, l):
		if not(l in self.data):
			self.data[l] = []
		return self.data[l]

	def record_write(self, lineno, id):
		if (id != magic_var_name):
			self.data_at(lineno-1).append(id)

	def visit_Name(self, node):
		#print("Name " + node.id + " @ line " + str(node.lineno) + " col " + str(node.col_offset))
		if isinstance(node.ctx, ast.Store):
			self.record_write(node.lineno, node.id)

	def visit_Subscript(self, node):
		#print("Subscript " + str(node.ctx) + " " + str(node.value) + " " + str(node.col_offset))
		if isinstance(node.ctx, ast.Store):
			id = self.find_id(node)
			if id == None:
				print("Warning: did not find id in subscript")
			else:
				self.record_write(node.lineno, id)

	def find_id(self, node):
		if hasattr(node, "id"):
			return node.id
		if hasattr(node, "value"):
			return self.find_id(node.value)
		return None

def compute_writes(lines):
	exception = None
	try:
		done = False
		while not done:
			try:
				code = "".join(lines)
				root = ast.parse(code)
				done = True
			except Exception as e:
				lineno = e.lineno-1
				did_lines_change = False
				while lineno >= 0:
					if lines[lineno].find(magic_var_name) != -1:
						# (lisa) able to remove boxes at comment lines inside a function body,
						# but not top level -- needs to handle the latter in RTVDisplay
						lines[lineno] = "\n"
						did_lines_change = True
					lineno = lineno - 1
				if not did_lines_change:
					raise
	except Exception as e:
		exception = e

	writes = {}
	if exception == None:
		#print(ast.dump(root))
		write_collector = WriteCollector()
		write_collector.visit(root)
		writes = write_collector.data
	return (writes, exception)

def compute_runtime_data(lines, writes, values):
	exception = None
	if len(lines) == 0:
		return ({}, exception)
	code = "".join(lines)
	l = Logger(lines, writes, values)
	try:
		l.run(code)
	except Exception as e:
		exception = e
	l.data = adjust_to_next_time_step(l.data, l.lines)
	remove_frame_data(l.data)
	return (l.data, exception)

def adjust_to_next_time_step(data, lines):
	envs_by_time = {}
	for lineno in data:
		for env in data[lineno]:
			if "time" in env:
				envs_by_time[env["time"]] = env
	new_data = {}
	for lineno in data:
		next_envs = []
		for env in data[lineno]:
			if "begin_loop" in env:
				next_envs.append(env)
			elif "end_loop" in env:
				next_envs.append(env)
			elif "time" in env:
				next_time = env["time"]+1
				while next_time in envs_by_time:
					next_env = envs_by_time[next_time]
					if "frame" in env and "frame" in next_env and env["frame"] is next_env["frame"]:
						curr_stmt = lines[env["lineno"]]
						next_stmt = lines[remove_R(next_env["lineno"])]
						if "Exception Thrown" in next_env or not is_loop_str(curr_stmt) or indent(next_stmt) > indent(curr_stmt):
							next_envs.append(next_env)
						break
					next_time = next_time + 1
				# next_time = env["time"]+1
				# if next_time in envs_by_time:
				# 	next_envs.append(envs_by_time[next_time])
		new_data[lineno] = next_envs
	return new_data

def remove_frame_data(data):
	for lineno in data:
		for env in data[lineno]:
			if "frame" in env:
				del env["frame"]

def findBlockEnd(i, lines):
	starts = 0
	ends = 0
	for lineno, line in enumerate(lines[i:]):
		if line.strip().find("End of") != -1:
			ends += 1
		if line.strip().find("Start of") != -1:
			starts += 1
		if starts == ends:
			return lineno + i
	return -1

def getBlockId(i, lines):
	starts = 0
	for lineno, line in enumerate(lines[:i+1]):
		if line.strip().find("Start of") != -1:
			starts += 1
	if findBlockEnd(i, lines) == -1: # no end to this block:
	    return -starts
	return starts


def getFunctionEnd(function_line, lines):
    function_indent = re.match(r'^\s*', lines[function_line - 1]).group(0) if re.match(r'^\s*', lines[function_line - 1]) else ''

    last_line = function_line
    inFunction_flag = False
    i = function_line
    while i < len(lines):
        line = lines[i]
        last_line = i

        line_indent = re.match(r'^\s*', line).group(0) if re.match(r'^\s*', line) else ''

        if len(line_indent) <= len(function_indent) and inFunction_flag:
            print("i", i)
            break
        if "def" in line: # all the comments are done
                    inFunction_flag = True

        i += 1

    return last_line

def computeSynthBlocks(lines):
	'''
		compute the synthesized blocks the user has created.
		It returns both the examples of each block and the code lines of each block
		@param lines: the code lines of the user's program
		@return: parsed_comments : map from block_id to parsed_comments
		comments_line : the lineno each block_id starts from
		code_blocks : the code that was generated in block_id

	'''

	comments_line={}
	code_blocks ={}
	prev_line=""
	for lineno, line in enumerate(lines):
		if line.strip().startswith("#! Start"):
			block_id = getBlockId(lineno, lines)
			print("blocklok", block_id)
			if block_id > 0: # noraml scope
			    end_lineno = findBlockEnd(lineno, lines)
			else: #function scope
			   end_lineno = getFunctionEnd(lineno, lines)
			print(f'{end_lineno=}')
			comments_line[block_id] = lineno + 1 # lineno starts at 0
			code_blocks[block_id] = lines[lineno : end_lineno]


	parsed_comments = {}
	for block_id in code_blocks:
		print(block_id)
		min_indent = min([len(line) - len(line.lstrip()) if line.strip() != "" else 1000000 for line in code_blocks[block_id]])
		code_blocks[block_id] = [line[min_indent:] for line in code_blocks[block_id]]
		parsed_comments[block_id] = parseComment("".join(code_blocks[block_id]))
		parsed_comments[block_id]["scope id"] = block_id
		parsed_comments[block_id]["code start"] = getFirstNonEmptyLine(code_blocks[block_id])

	return  parsed_comments, code_blocks, comments_line

def getFirstNonEmptyLine(block_code):
	print(f'{block_code=}')

	last_comment_lineno = len(block_code)-1
	for i, line in enumerate(block_code):
		if line.find("#!") == -1: # we start the code
			last_comment_lineno = i -1
			break

	for i, line in enumerate(block_code[last_comment_lineno+1:]):
		if line.strip() != "":
			print(i + last_comment_lineno)
			return i + last_comment_lineno

	assert(False)



class UnitTest:
	def __init__(self, lines, inputs, expected):
		print(f'{inputs=}')
		self.lines = lines
		self.inputs = {name.replace("_in",""): val for name, val in inputs.items()}
		self.expected = expected

	def run(self):
		'''
			runs the unit test and returns the result of the test and the exception if any as a tuple
		'''
		debugger = bdb.Bdb()
		problems={}
		try:
		    print(f"{self.inputs=}")
		    print(f"{''.join(self.lines)=}")
		    debugger.run("".join(self.lines), locals=self.inputs, globals = self.inputs)
		except Exception as e:
			return False ,"Exception Thrown: " + str(e)
		for var in self.expected:
			if var in debugger.botframe.f_locals['locals'] and self.expected[var] != debugger.botframe.f_locals['locals'][var]:
			    problems[var] = ( str(self.expected[var]), str(debugger.botframe.f_locals['locals'][var]))
		if len(problems) == 0:
		    return True, ""

		error_string = "\n".join([f"{var} is expected to be {problems[var][0]} but it is {problems[var][1]}" for var in problems.keys()])
		return False, error_string


def compute_tests_results(code_blocks, parsed_comments, comments_line, run_time_data):
	'''
		compute the unit tests results
	'''
	tests = build_tests(code_blocks, parsed_comments, comments_line, run_time_data)

	return runTests(tests)

def build_tests(code_blocks, parsed_comments, comments_line, run_time_data):
	tests = {}
	print("building tests...")
	print(f'{parsed_comments=}')
	for block_id in parsed_comments:

		comment_size = parsed_comments[block_id]["code start"] #includes new lines
		liveEnvs = run_time_data[comments_line[block_id]+comment_size]
		for comment_idx in range(len(parsed_comments[block_id]["envs"])):
			inputs = parsed_comments[block_id]["envs"][comment_idx]
			expected = parsed_comments[block_id]["out"][comment_idx]
			targetEnv = {key.replace("_in", ""):value for (key,value) in inputs.items()}
			if not isLiveEnv(targetEnv, liveEnvs, list(expected.keys())):
			    if block_id < 0:
			        code_blocks[block_id].append(addFunctionCall(code_blocks[block_id]))
			    tests[(block_id, comment_idx)] = UnitTest(code_blocks[block_id], inputs, expected)

	return tests

def addFunctionCall(lines):
    for line in lines:
        if "def" in line:
            function_pattern = r"def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*:"

            match = re.match(function_pattern, line)
            if match:
                function_name = match.group(1)
                parameters = match.group(2)
                parameter_list = [param.strip() for param in parameters.split(',')]
                parameter_string = ', '.join(parameter_list)

                function_call = f"rv = {function_name}({parameter_string})\n"
                return function_call
            else:
                return ""

def runTests(tests):
	'''
		runs the unit tests and returns the results of the tests
	'''

	results = {}
	for test in tests:
		print("runnig test", test)
		results[test] = tests[test].run()
		print(f'{results[test]}')
	return results

def isLiveEnv(targetEnv, LiveEnvsList, ignoredVars=[]):
		ignoredVars+=['time', "lineno", "#", "$", "prev_lineno", "next_lineno"]
		for liveEnv in LiveEnvsList:
			isSame = True
			for varName in targetEnv.keys():
				if varName not in ignoredVars:
					if varName not in liveEnv.keys():
						isSame = False
						break
					if targetEnv[varName] != tryEval(liveEnv[varName]):
						isSame = False
						break
			if isSame:
				return True
		return False




def main(file, values_file = None):
	lines = load_code_lines(file)
	values = []

	if values_file:
		values = json.load(open(values_file))

	return_code = 0
	run_time_data = {}

	(writes, exception) = compute_writes(lines)

	if exception != None:
		return_code = 1
	else:
		(run_time_data, exception) = compute_runtime_data(lines, writes, values)
		if (exception != None):
			return_code = 2


	with open(file + ".out", "w") as out:
		out.write(json.dumps((return_code, writes, run_time_data)))
	comments_line= {}
	try:
		parsed_comments, code_blocks, comments_line = computeSynthBlocks(lines)
		results = compute_tests_results(code_blocks, parsed_comments, comments_line, run_time_data)
	except Exception as e:
		print(e)
		results = {}
	with open(file + ".test", "w") as out:
		out.write(json.dumps(({str(k): v for k, v in results.items()}, comments_line)))

	if exception != None:
		raise exception

if __name__ == '__main__':
	# The following adds the current working directory to the path
	# so that imports look at the current working directory.
	# (by default they look at the directory of the script)
	sys.path.append(os.getcwd())
	if len(sys.argv) > 2:
		main(sys.argv[1], sys.argv[2])
	else:
		main(sys.argv[1])
