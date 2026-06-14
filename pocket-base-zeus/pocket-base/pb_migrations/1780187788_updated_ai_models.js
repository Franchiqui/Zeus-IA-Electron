/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2249708725")

  // update collection data
  unmarshal({
    "name": "models"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2249708725")

  // update collection data
  unmarshal({
    "name": "ai_models"
  }, collection)

  return app.save(collection)
})
