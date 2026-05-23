import { z } from 'zod';
import { requireAnyPermissions } from '../middleware/authorization.js';
import { ReferenceRepository } from '../repositories/referenceRepository.js';
import { ReferenceService } from '../services/referenceService.js';
import { createReferenceRouter } from '../routes/referenceRoutes.js';

const statusSchema = z.enum(['active', 'inactive']).default('active');

const branchCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  city: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  is_active: z.boolean().optional().default(true),
});
const branchUpdateSchema = branchCreateSchema.partial();

const agentCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  governorate: z.string().optional(),
  phone: z.string().optional(),
  branch_id: z.string().uuid().optional(),
  is_active: z.boolean().optional().default(true),
});
const agentUpdateSchema = agentCreateSchema.partial();

const customerCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  branch_id: z.string().uuid().optional(),
  status: statusSchema.optional(),
});
const customerUpdateSchema = customerCreateSchema.partial();

const senderReceiverCreateSchema = z.object({
  code: z.string().min(1),
  full_name: z.string().min(1),
  phone: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
  type: z.enum(['sender', 'receiver', 'both']).default('both'),
  status: statusSchema.optional(),
  branch_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  created_by_user_id: z.string().uuid().optional(),
});
const senderReceiverUpdateSchema = senderReceiverCreateSchema.partial();

const driverCreateSchema = z.object({
  code: z.string().min(1),
  full_name: z.string().min(1),
  phone: z.string().optional(),
  license_number: z.string().optional(),
  branch_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  status: statusSchema.optional(),
});
const driverUpdateSchema = driverCreateSchema.partial();

const vehicleCreateSchema = z.object({
  code: z.string().min(1),
  plate_number: z.string().min(1),
  model: z.string().optional(),
  capacity_kg: z.coerce.number().optional(),
  branch_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  status: statusSchema.optional(),
});
const vehicleUpdateSchema = vehicleCreateSchema.partial();

const cityCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  region: z.string().optional(),
  has_branch: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true),
});
const cityUpdateSchema = cityCreateSchema.partial();

const goodsTypeCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  is_active: z.boolean().optional().default(true),
});
const goodsTypeUpdateSchema = goodsTypeCreateSchema.partial();

const tariffCreateSchema = z.object({
  code: z.string().min(1),
  from_city_id: z.string().uuid(),
  to_city_id: z.string().uuid(),
  goods_type_id: z.string().uuid(),
  price_per_kg: z.coerce.number().nonnegative(),
  minimum_charge: z.coerce.number().nonnegative(),
  valid_from: z.string().min(1),
  valid_to: z.string().optional(),
  is_active: z.boolean().optional().default(true),
});
const tariffUpdateSchema = tariffCreateSchema.partial();

export function createReferenceRouters() {
  const branchesRepository = new ReferenceRepository({
    table: 'branches',
    createFields: ['code', 'name', 'city', 'address', 'phone', 'is_active'],
    updateFields: ['code', 'name', 'city', 'address', 'phone', 'is_active'],
  });

  const agentsRepository = new ReferenceRepository({
    table: 'agents',
    createFields: ['code', 'name', 'governorate', 'phone', 'branch_id', 'is_active'],
    updateFields: ['code', 'name', 'governorate', 'phone', 'branch_id', 'is_active'],
  });

  const customersRepository = new ReferenceRepository({
    table: 'customers',
    createFields: ['code', 'name', 'phone', 'city', 'address', 'branch_id', 'status'],
    updateFields: ['code', 'name', 'phone', 'city', 'address', 'branch_id', 'status'],
  });

  const sendersReceiversRepository = new ReferenceRepository({
    table: 'senders_receivers',
    createFields: ['code', 'full_name', 'phone', 'city', 'address', 'type', 'status', 'branch_id', 'agent_id', 'created_by_user_id'],
    updateFields: ['code', 'full_name', 'phone', 'city', 'address', 'type', 'status', 'branch_id', 'agent_id'],
  });

  const driversRepository = new ReferenceRepository({
    table: 'drivers',
    createFields: ['code', 'full_name', 'phone', 'license_number', 'branch_id', 'status', 'agent_id'],
    updateFields: ['code', 'full_name', 'phone', 'license_number', 'branch_id', 'status', 'agent_id'],
  });

  const vehiclesRepository = new ReferenceRepository({
    table: 'vehicles',
    createFields: ['code', 'plate_number', 'model', 'capacity_kg', 'branch_id', 'status', 'agent_id'],
    updateFields: ['code', 'plate_number', 'model', 'capacity_kg', 'branch_id', 'status', 'agent_id'],
  });

  const citiesRepository = new ReferenceRepository({
    table: 'cities',
    createFields: ['code', 'name', 'region', 'has_branch', 'is_active'],
    updateFields: ['code', 'name', 'region', 'has_branch', 'is_active'],
  });

  const goodsTypesRepository = new ReferenceRepository({
    table: 'goods_types',
    createFields: ['code', 'name', 'description', 'is_active'],
    updateFields: ['code', 'name', 'description', 'is_active'],
  });

  const tariffsRepository = new ReferenceRepository({
    table: 'tariffs',
    createFields: [
      'code',
      'from_city_id',
      'to_city_id',
      'goods_type_id',
      'price_per_kg',
      'minimum_charge',
      'valid_from',
      'valid_to',
      'is_active',
    ],
    updateFields: [
      'code',
      'from_city_id',
      'to_city_id',
      'goods_type_id',
      'price_per_kg',
      'minimum_charge',
      'valid_from',
      'valid_to',
      'is_active',
    ],
  });

  return {
    branches: createReferenceRouter({
      service: new ReferenceService(branchesRepository),
      createSchema: branchCreateSchema,
      updateSchema: branchUpdateSchema,
      readPermissions: ['settings.branches.read'],
      writePermissions: ['settings.branches.write'],
    }),
    agents: createReferenceRouter({
      service: new ReferenceService(agentsRepository),
      createSchema: agentCreateSchema,
      updateSchema: agentUpdateSchema,
      readPermissions: ['settings.agents.read'],
      writePermissions: ['settings.agents.write'],
    }),
    customers: createReferenceRouter({
      service: new ReferenceService(customersRepository),
      createSchema: customerCreateSchema,
      updateSchema: customerUpdateSchema,
      readPermissions: ['shipments.read'],
      writePermissions: ['shipments.write'],
    }),
    sendersReceivers: createReferenceRouter({
      service: new ReferenceService(sendersReceiversRepository),
      createSchema: senderReceiverCreateSchema,
      updateSchema: senderReceiverUpdateSchema,
      readPermissions: ['parties.view', 'shipments.read'],
      readMatch: 'any',
      writePermissions: ['parties.manage', 'shipments.write'],
      writeMatch: 'any',
    }),
    drivers: createReferenceRouter({
      service: new ReferenceService(driversRepository),
      createSchema: driverCreateSchema,
      updateSchema: driverUpdateSchema,
      readPermissions: ['drivers.view'],
      writePermissions: ['parties.manage'],
    }),
    vehicles: createReferenceRouter({
      service: new ReferenceService(vehiclesRepository),
      createSchema: vehicleCreateSchema,
      updateSchema: vehicleUpdateSchema,
      readPermissions: ['vehicles.view'],
      writePermissions: ['parties.manage'],
    }),
    cities: createReferenceRouter({
      service: new ReferenceService(citiesRepository),
      createSchema: cityCreateSchema,
      updateSchema: cityUpdateSchema,
      readPermissions: ['shipments.read'],
      writePermissions: ['settings.system.write'],
    }),
    goodsTypes: createReferenceRouter({
      service: new ReferenceService(goodsTypesRepository),
      createSchema: goodsTypeCreateSchema,
      updateSchema: goodsTypeUpdateSchema,
      readPermissions: ['shipments.read'],
      writePermissions: ['settings.system.write'],
      postGuard: requireAnyPermissions(['settings.system.write', 'shipments.write']),
    }),
    tariffs: createReferenceRouter({
      service: new ReferenceService(tariffsRepository),
      createSchema: tariffCreateSchema,
      updateSchema: tariffUpdateSchema,
      readPermissions: ['finance.read'],
      writePermissions: ['finance.write'],
    }),
  };
}
