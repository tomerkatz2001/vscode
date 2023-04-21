from parsec import *
import sys
import ast
import json



nameParser = regex(r'[_a-zA-Z][_a-zA-Z0-9]*')
amountParser = regex(r' *')#string("(")>> regex(r'[0-9]*') << string("), ")
numberParser = regex(r' *-?\d+ *')
stringParser = regex(r'\".*?\"|\'.*?\'')
listParser = regex(r'\[[^=]*\]')
valuesParser = sepEndBy1((nameParser << regex(r' *= *')) + (numberParser ^ stringParser ^ listParser), regex(r' *, *')^regex(r' *'))
counter = 0
@generate
def varNames():
	yield regex(r" *of: ")
	vars = yield sepBy(nameParser , regex(r'\, *'))
	return vars
@generate
def blockStart():
	yield regex(r" *#! *Start of synth number: *")
	id = yield numberParser
	return id
@generate
def envs():
	x = yield sepBy(regex(r"\s*#!\s*") >> ((numberParser << regex(r' *\) *')) + (valuesParser + (regex(r' *=> *') >> valuesParser))) , regex('\s*'))
	return x

@generate
def blockEnd():
	yield string("#! End of synth number: ")
	id = yield numberParser
	return id

def tryEval(val):
	try:
		val = ast.literal_eval(val)
	except ValueError:
		pass
	return val

def parseComment(comment):
	parser = (blockStart+varNames<<(regex(r' *')+regex(r'(\!\!)* *'))) + envs
	parser_result = parser.parse(comment)
	inputs = [{t[0]: tryEval(t[1]) for t in line[1][0]} for line in parser_result[1]] #left of the ""=>"
	outputs = [{t[0]: tryEval(t[1]) for t in line[1][1]} for line in parser_result[1]] #right of the ""=>""
	parsed_comment ={
		"varnames": parser_result[0][1],
		"envs": inputs,
		"out" :outputs,
		"synthCount" : int(parser_result[0][0].strip()),
		}
	return parsed_comment


def main(input):
	parsed_comment = parseComment(input)
	print(json.dumps(parsed_comment, indent = 4))



if __name__ == '__main__':
	main(sys.argv[1])