import apig_wsgi
from app import create_app

flask_app = create_app()
lambda_handler = apig_wsgi.make_lambda_handler(flask_app)
