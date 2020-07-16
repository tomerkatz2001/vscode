import re
import io
import base64
import numpy as np
from PIL import Image

# Code manipulation

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

# Image Processing

def is_ndarray_img(v):
	return isinstance(v, np.ndarray) and v.dtype.name == 'uint8' and len(v.shape) == 3 and v.shape[2] == 3

def is_list_img(v):
	return isinstance(v, list) and len(v) > 0 and isinstance(v[0], list) and len(v[0]) > 0 and (isinstance(v[0][0], list) or isinstance(v[0][0], tuple)) and len(v[0][0]) == 3

def if_img_convert_to_html(v):
	if is_list_img(v):
		return list_to_html(v, format='png')
	elif is_ndarray_img(v):
		return ndarray_to_html(v, format='png')
	else:
		return None

# Convert PIL.Image to html
def pil_to_html(img, **kwargs):
	file_buffer = io.BytesIO()
	img.save(file_buffer, **kwargs)
	encoded = base64.b64encode(file_buffer.getvalue())
	encoded_str = str(encoded)[2:-1]
	img_format = kwargs["format"]
	return f"<img src='data:image/{img_format};base64,{encoded_str}'>"

# Convert ndarray to PIL.Image
def ndarray_to_pil(arr, min_width = None, max_width = None):
	img = Image.fromarray(arr)
	h = img.height
	w = img.width
	new_width = None
	if w > max_width:
		new_width = max_width
	if w < min_width:
		new_width = min_width
	if new_width != None:
		img = img.resize((new_width, int(h*(new_width / w))), resample = Image.BOX)
	return img

# Convert list of lists to ndarray
def list_to_ndarray(arr):
	return np.asarray(arr, dtype=np.uint8)

def ndarray_to_html(arr, **kwargs):
	return pil_to_html(ndarray_to_pil(arr, 60, 150), **kwargs)

def list_to_html(arr, **kwargs):
	return ndarray_to_html(list_to_ndarray(arr), **kwargs)
