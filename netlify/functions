import awsgi
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

@app.route("/.netlify/functions/api/route", methods=["POST", "GET"])
def route_handler():
    # Call your backend routing logic here
    return jsonify({"status": "success", "message": "Cool route calculated!"})

def handler(event, context):
    return awsgi.response(app, event, context)
