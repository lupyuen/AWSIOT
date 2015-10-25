#!/usr/bin/env python

# This program tells AWS IoT the desired state of our device. It sends a REST request to AWS IoT over HTTPS.
# The program here uses digital signatures to sign the REST request so that the AWS IoT server can authenticate us.

import sys, os, datetime, hashlib, hmac, urllib2

# TODO: Name of our Raspberry Pi, also known as our "Thing Name"
# deviceName = "g88_pi"
deviceName = "g0_temperature_sensor"


def sign(key, msg):
    # Function for signing a HTTPS request to AWS, so that AWS can authenticate us.  See:
    # http://docs.aws.amazon.com/general/latest/gr/signature-v4-examples.html#signature-v4-examples-python
    # Return the signature of the message, signed with the specified key.
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def getSignatureKey(key, date_stamp, regionName, serviceName):
    # Also used for signing the HTTPS request to AWS.
    # Return the key to be used for signing the request.
    kDate = sign(('AWS4' + key).encode('utf-8'), date_stamp)
    kRegion = sign(kDate, regionName)
    kService = sign(kRegion, serviceName)
    kSigning = sign(kService, 'aws4_request')
    return kSigning


def sendAWSIoTRequest(method, deviceName2, payload2):
    # Send a REST request to AWS IoT over HTTPS.  Only method "POST" is supported, which will update the Thing Shadow
    # for the specified device with the specified payload.
    # This is the access key for user lambda_iot_user.  Somehow we can't sign using the environment access key.
    access_key = 'AKIAIAAXOWVF3FX2XBZA'
    secret_key = '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'
    if access_key is None or secret_key is None:
        print('No access key is available.')
        sys.exit()

    # Create a date for headers and the credential string
    t = datetime.datetime.utcnow()
    amz_date = t.strftime('%Y%m%dT%H%M%SZ')
    date_stamp = t.strftime('%Y%m%d')  # Date w/o time, used in credential scope

    # ************* TASK 1: CREATE A CANONICAL REQUEST *************
    # http://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html

    # Step 1 is to define the verb (GET, POST, etc.)--already done.

    # Step 2: Create canonical URI--the part of the URI from domain to query string (use '/' if no path)
    canonical_uri = '/things/' + deviceName2 + '/shadow'

    # Step 3: Create the canonical query string.
    canonical_querystring = ''

    # Step 4: Create the canonical headers. Header names and values must be trimmed and lowercase, and sorted in ASCII
    # order. Note that there is a trailing \n.  Use AWS command line "aws iot describe-endpoint" to get the address.
    host = 'A1P01IYM2DOZA0.iot.us-west-2.amazonaws.com'
    user_agent = "TP-IoT"  # Any value should work.
    canonical_headers = 'host:' + host + '\n' + \
                        'user-agent:' + user_agent + '\n' + \
                        'x-amz-date:' + amz_date + '\n'
    print("canonical_headers = " + canonical_headers)

    # Step 5: Create the list of signed headers. This lists the headers in the canonical_headers list, delimited with
    # ";" and in alpha order. Note: The request can include any headers; canonical_headers and signed_headers include
    # those that you want to be included in the hash of the request. "Host" and "x-amz-date" are always required. For
    # IoT, user-agent is also required.
    signed_headers = 'host;user-agent;x-amz-date'
    print("signed_headers = " + signed_headers)

    # Step 6: Create payload hash. In this example, the payload (body of the request) contains the request parameters.
    payload_hash = hashlib.sha256(payload2).hexdigest()
    print("payload_hash = " + payload_hash)

    # Step 7: Combine elements to create create canonical request
    canonical_request = method + '\n' + canonical_uri + '\n' + canonical_querystring + '\n' + \
                        canonical_headers + '\n' + signed_headers + '\n' + payload_hash
    print("canonical_request = " + canonical_request)

    # ************* TASK 2: CREATE THE STRING TO SIGN*************
    # Match the algorithm to the hashing algorithm you use, either SHA-1 or SHA-256 (recommended)
    region = 'us-west-2'
    service = 'iotdata'
    algorithm = 'AWS4-HMAC-SHA256'
    credential_scope = date_stamp + '/' + region + '/' + service + '/' + 'aws4_request'
    print("credential_scope = " + credential_scope)
    string_to_sign = algorithm + '\n' + amz_date + '\n' + credential_scope + '\n' + \
                     hashlib.sha256(canonical_request).hexdigest()
    print("string_to_sign = " + string_to_sign)

    # ************* TASK 3: CALCULATE THE SIGNATURE *************
    # Create the signing key using the function defined above.
    signing_key = getSignatureKey(secret_key, date_stamp, region, service)
    # Sign the string_to_sign using the signing_key
    signature = hmac.new(signing_key, (string_to_sign).encode('utf-8'), hashlib.sha256).hexdigest()

    # ************* TASK 4: ADD SIGNING INFORMATION TO THE REQUEST *************
    # Put the signature information in a header named Authorization.
    authorization_header = algorithm + ' ' + 'Credential=' + access_key + '/' + credential_scope + ', ' + \
                           'SignedHeaders=' + signed_headers + ', ' + 'Signature=' + signature
    print("authorization_header = " + authorization_header)

    # For AWS IoT, the request should include the following. The headers must be included in the canonical_headers and
    # signed_headers values, as noted earlier. Order here is not significant.
    content_type = ""
    headers = {'Content-Type': content_type,
               'Host': host,
               'User-Agent': user_agent,
               'X-Amz-Date': amz_date,
               'Authorization': authorization_header}
    print("headers = " + str(headers))

    # ************* SEND THE REQUEST *************
    url = "https://" + host + canonical_uri
    print("url = " + url)
    request = urllib2.Request(url, payload2, headers)
    result2 = urllib2.urlopen(request).read()
    return result2


def lambda_handler(event, context):
    # This is the main logic of the program. We construct a JSON payload to tell AWS IoT to set our device's desired
    # state. Then we wrap the JSON payload as a REST request and send to AWS IoT over HTTPS. The REST request needs
    # to be signed so that the AWS IoT server can authenticate us. This code is written as an AWS Lambda handler so
    # that we can run this code on the command line as well as AWS Lambda.
    print("event = " + str(event))
    print("context = " + str(context))
    try:
        # Construct the JSON payload to set the desired state for our device actuator, e.g. LED should be on.
        payload = '''{
            "state": {
                "desired": {
                    "led": "on",
                    "timestamp": "''' + datetime.datetime.now().isoformat() + '''"
                }
            }
        }
        '''
        print("payload = " + payload)

        # Send the "set desired state" request to AWS IoT via a REST request over HTTPS.  We are actually updating the
        # Thing Shadow, according to AWS IoT terms.
        result = sendAWSIoTRequest("POST", deviceName, payload)
        print("result = " + str(result))
    except:
        # In case of error, show the exception.
        print('Request failed')
        raise
    else:
        # If no error, return the result.
        return result
    finally:
        # If any case, display "Done".
        print('Done')


# The main program starts here.  If started from a command line, run the lambda function manually.
if os.environ.get("AWS_LAMBDA_FUNCTION_NAME") is None:
    lambda_handler({}, {})


'''
Some of the above signature settings were obtained from capturing the debug output of the AWS command line tool:
aws --debug --region us-west-2 --profile tp-iot iot-data update-thing-shadow --thing-name g0_temperature_sensor --payload "{ \"state\": {\"desired\": { \"led\": \"on\" } } }"  output.txt && cat output.txt
aws --debug --endpoint-url http://g89-pi.local --no-verify-ssl --region us-west-2 --profile tp-iot iot-data update-thing-shadow --thing-name g0_temperature_sensor --payload "{ \"state\": {\"desired\": { \"led\": \"on\" } } }"  output.txt && cat output.txt

lambda_iot_user has the following policy:
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents"
            ],
            "Resource": "arn:aws:logs:*:*:*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "iot:UpdateThingShadow"
            ],
            "Resource": [
                "*"
            ]
        }
    ]
}
'''
