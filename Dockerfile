FROM python:3.11-buster AS build

RUN apt-get update && apt-get install -y supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

WORKDIR /scores_server
COPY scores_server/requirements.txt .
RUN pip install -r requirements.txt

WORKDIR /
ADD ./scores_html /scores_html
ADD ./scores_server /scores_server

EXPOSE 8000
EXPOSE 5005
EXPOSE 5000


CMD ["/usr/bin/supervisord"]