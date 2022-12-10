from parsec import *
import sys
import ast
import json



nameParser = regex(r'[_a-zA-Z][_a-zA-Z0-9]*')
amountParser = regex(r' *')#string("(")>> regex(r'[0-9]*') << string("), ")
numberParser = regex(r' *\d+ *')
stringParser = regex(r'\".*?\"|\'.*?\'')
listParser = regex(r'\[[^=]*\]')
valuesParser = sepEndBy1((nameParser << regex(r' *= *')) + (numberParser ^ stringParser ^ listParser), regex(r' *, *')^regex(r' *'))
counter = 0
@generate
def varNames():
	yield string("#! Start Synth of: ")
	vars = yield sepBy(nameParser , regex(r'\, *')) + numberParser
	return vars

@generate
def envs():
	x = yield sepBy( regex("#! *") >>((numberParser << regex(r' *\) *')) + (valuesParser + (regex(r' *=> *') >> valuesParser))) ,  string("\n"))
	return x


def parseComment(comment):
	parser = (varNames<<string("\n")) + envs
	parser_result = parser.parse(comment)

	parsed_comment ={
		"varnames": parser_result[0][0],
		"envs": [{t[0]: t[1] for t in line[1][0]} for line in parser_result[1]], #left of the ""=>"
		"out" : [{t[0]: t[1] for t in line[1][1]} for line in parser_result[1]], #right of the "=>"
		"synthCount" : int(parser_result[0][1].strip()),
		}
	return parsed_comment

def main(input):
	parsed_comment = parseComment(input)
	print(json.dumps(parsed_comment, indent = 4))



if __name__ == '__main__':
	main(sys.argv[1])