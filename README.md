# s3test
s3 multipart upload testing for timeout error

## get started
simply run `npm install && bower install` and `gulp watch` then your are ready to debug at http://localhost:8000

## resources

related aws user:
  arn:aws:iam::674223647607:user/s3-test-timeout

related user policy:
  $ aws --profile tesera iam get-user-policy --user-name s3-test-timeout --policy-name s3-test-timeout --output json
