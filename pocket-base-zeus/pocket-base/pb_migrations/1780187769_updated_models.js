/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // update collection data
  unmarshal({
    "name": "models_A"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("6zsfy21nhwtnwma")

  // update collection data
  unmarshal({
    "name": "models"
  }, collection)

  return app.save(collection)
})
