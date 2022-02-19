FROM python:3.8-buster AS build

RUN apt-get update && apt-get install -y supervisor
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf


ADD ./scores_html /scores_html
ADD ./scores_server /scores_server

EXPOSE 8000
EXPOSE 5005
EXPOSE 5000

WORKDIR /scores_server
RUN pip install -r requirements.txt

CMD ["/usr/bin/supervisord"]