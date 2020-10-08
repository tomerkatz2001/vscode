# ---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
# ---------------------------------------------------------------------------------------------

import sys
import ast
import bdb
import json
import re
import core
import time
import time
import types
import numpy as np
# from PIL import Image

def add_html_escape(html):
	return f"```html\n{html}\n```"

def add_red_format(html):
	return f"<div style='color:red;'>{html}</div>"

def is_loop_str(str):
	return re.search("(for|while).*:", str.strip()) != None

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

class Logger(bdb.Bdb):
	def __init__(self, lines):
		bdb.Bdb.__init__(self)
		self.lines = lines
		self.time = 0
		self.prev_env = None
		self.data = {}
		self.active_loops = []
		self.preexisting_locals = None
		self.exception = None

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

		if frame.f_code.co_name == "<module>" and self.preexisting_locals == None:
			self.preexisting_locals = set(frame.f_locals.keys())

		if frame.f_code.co_name == "<listcomp>" or frame.f_code.co_name == "<dictcomp>" or frame.f_code.co_filename != "<string>":
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
			if is_return_str(prev_stmt):
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
		html = core.if_img_convert_to_html(v)
		if html == None:
			return repr(v)
		else:
			return add_html_escape(html)

	def record_env(self, frame, lineno):
		if self.time >= 100:
			self.set_quit()
			return
		env = {}
		env["frame"] = frame
		env["time"] = self.time
		self.add_loop_info(env)
		self.time = self.time + 1
		for k in frame.f_locals:
			if k != core.magic_var_name and (frame.f_code.co_name != "<module>" or not k in self.preexisting_locals):
				r = self.compute_repr(frame.f_locals[k])
				if (r != None):
					env[k] = self.compute_repr(frame.f_locals[k])
		env["lineno"] = lineno

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

		if frame.f_code.co_name == "<listcomp>" or frame.f_code.co_name == "<dictcomp>" or frame.f_code.co_filename != "<string>":
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
		if (id != core.magic_var_name):
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
					if lines[lineno].find(core.magic_var_name) != -1:
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

def compute_runtime_data(lines):
	exception = None
	if len(lines) == 0:
		return ({}, exception)
	code = "".join(lines)
	l = Logger(lines)
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
					if ("frame" in env and "frame" in next_env and env["frame"] is next_env["frame"]):
						curr_stmt = lines[env["lineno"]]
						next_stmt = lines[remove_R(next_env["lineno"])]
						if not is_loop_str(curr_stmt) or indent(next_stmt) > indent(curr_stmt):
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

def main():

	start = time.time()
	if len(sys.argv) != 2:
		print("Usage: run <file-name>")
		exit(-1)

	lines = core.load_code_lines(sys.argv[1])
	code = "".join(lines)
	# print("(" + code + ")")

	return_code = 0
	run_time_data = {}
	writes = {}

	(writes, exception) = compute_writes(lines)

	if exception != None:
		return_code = 1
	else:
		(run_time_data, exception) = compute_runtime_data(lines)
		if (exception != None):
			return_code = 2

	# print(writes)
	# print()
	# print(run_time_data)

	with open(sys.argv[1] + ".out", "w") as out:
		out.write(json.dumps((return_code, writes, run_time_data)))

	end = time.time()
	# print("Time: " + str(end - start))

	if exception != None:
		raise exception

main()
