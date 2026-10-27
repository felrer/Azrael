"""Run the unchanged deployment engine snapshot expression under the hidden wrapper."""
import sys
expression,*args=sys.argv[1:]
sys.argv=['-c',*args]
exec(compile(expression,'<deployment-engine-snapshot>','exec'))

