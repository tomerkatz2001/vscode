import sys
import ast
import bdb
import json
import re
import core
import time
import numpy as np
from PIL import Image

class ImgRecorder:

	def start(self, resize, new_width):
		self.resize = resize
		self.new_width = new_width
		self.all_count = 0
		self.every = 1
		self.in_stage_count = 0
		self.stage_size = 3
		self.visualized_count = 0
		self.images = []

	def record_img(self, im):
		if self.in_stage_count == self.stage_size:
			print("Going to next stage: ", self.all_count, self.every)
			self.in_stage_count = 0
			self.every = self.every * 2
		if self.all_count % self.every == 0:
			self.in_stage_count = self.in_stage_count + 1
			self.visualized_count = self.visualized_count + 1
			if core.is_list_img(im):
				im = core.list_to_ndarray(im)
			if core.is_ndarray_img(im):
				to_append = core.ndarray_to_pil(im, 60, 150)
				self.images.append(to_append)
			else:
				raise ValueError()
		self.all_count = self.all_count + 1

	def finish(self, filename):
		if (len(self.images) == 0):
			raise ValueError()

		print("All count:" + str(self.all_count))
		print("Visualized count: " + str(self.visualized_count))
		print("Converting to html")
		s = core.pil_to_html(self.images[0], format='png',
					save_all=True, append_images=self.images[1:], optimize=False, duration=100, loop=0)
		# self.images[0].save("out.gif", format='GIF',
		#			 save_all=True, append_images=self.images[1:], optimize=False, duration=40, loop=0)
		# self.images[0].save("out.apng", format='PNG',
		#			 save_all=True, append_images=self.images[1:], optimize=False, duration=40, loop=0)
		print("Writing to file")
		f = open(filename, "w")
		f.write(s)
		f.close()

class ImgLogger(bdb.Bdb):
	def __init__(self, lines, lineno, varname):
		bdb.Bdb.__init__(self)
		self.lineno = lineno
		self.varname = varname
		self.recorder = ImgRecorder()
		self.recorder.start(False, 100)
		self.record = False

	def user_line(self, frame):

		if frame.f_code.co_name == "<module>" or frame.f_code.co_name == "<listcomp>" or frame.f_code.co_name == "<dictcomp>" or frame.f_code.co_filename != "<string>":
			return

		if self.record:
			self.recorder.record_img(frame.f_locals[self.varname])
		self.record = (frame.f_lineno == self.lineno)


	def user_return(self, frame, rv):

		if frame.f_code.co_name == "<module>" or frame.f_code.co_name == "<listcomp>" or frame.f_code.co_name == "<dictcomp>" or frame.f_code.co_filename != "<string>":
			return

		if (frame.f_lineno-1 != self.lineno):
			return

		self.recorder.record_img(frame.f_locals[self.varname])


def main():

	start = time.time()
	if len(sys.argv) != 4:
		print("Usage: img-summary <file-name> <line-number> <var-name>")
		exit(-1)

	with open(sys.argv[1]) as f:
		lines = f.readlines()

	code = "".join(lines)
	print(code)

	l = ImgLogger(code, int(sys.argv[2]), sys.argv[3])
	l.run(code)
	l.recorder.finish(sys.argv[1] + ".out")

	end = time.time()
	print("Time: " + str(end - start))

main()
