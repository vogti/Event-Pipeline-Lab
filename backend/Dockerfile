# syntax=docker/dockerfile:1

FROM gradle:jdk25 AS build
WORKDIR /workspace

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=gitmeta . /workspace/.git
COPY . /workspace
WORKDIR /workspace/backend
RUN chmod +x ./gradlew && ./gradlew --no-daemon clean bootJar

FROM eclipse-temurin:25-jre
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /workspace/backend/build/libs/epl-backend-*.jar /app/app.jar

EXPOSE 8080

ENTRYPOINT ["java", "-Xms256m", "-Xmx512m", "-jar", "/app/app.jar"]
