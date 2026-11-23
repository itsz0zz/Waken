# Alpine + framework-dependent publish: the smallest image that runs this API.
# The SDK runs on the build machine's platform, so an amd64 image builds quickly on an Apple Silicon Mac.
FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:10.0.404-alpine3.24 AS build
WORKDIR /src
COPY Waken.Api.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app --no-restore -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0.15-alpine3.24
WORKDIR /app
COPY --from=build /app .
# The cache volume takes its owner from this directory when Docker creates it.
RUN mkdir -p /data/covers && chown -R "$APP_UID:$APP_UID" /data
USER $APP_UID
VOLUME /data
ENTRYPOINT ["dotnet", "Waken.Api.dll"]
